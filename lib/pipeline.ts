/**
 * The agent pipeline: interview → (code validation) → draft → critic → revise → re-check.
 * Each stage is a separate, focused model call with its own prompt.
 */
import { EFFORT, LIMITATION_YEARS, MAX_INTERVIEW_TURNS, SMALL_CLAIMS_CEILING_ILS, todayInIsrael } from "./config";
import { checkDraft, type DraftIssue } from "./draftChecks";
import { computeFieldStatuses } from "./fields";
import { callStructured, callText, loadPrompt } from "./llm";
import { mergeCaseFile, mergeUnknown } from "./merge";
import { fromModel, toModel } from "./modelSchema";
import {
  CritiqueSchema,
  FIELD_KEYS,
  InterviewTurnSchema,
  type CaseFile,
  type ChatMessage,
  type FieldKey,
  type InterviewTurn,
} from "./schema";
import { validateCase, type ValidationIssue, type ValidationResult } from "./validate";

// ───────────────────────────── Interview ─────────────────────────────

export type InterviewState = {
  caseFile: CaseFile;
  unknownFields: FieldKey[];
  /** Validation issue codes already shown to the user, so they are announced once. */
  raisedIssueCodes: string[];
};

export type InterviewResult = InterviewState & {
  assistantMessage: string;
  /** New code-validation issues to show in the chat (deterministic, not model-written). */
  notices: ValidationIssue[];
  flags: InterviewTurn["flags"];
  nextQuestions: string[];
  validation: ValidationResult;
  fields: ReturnType<typeof computeFieldStatuses>;
};

function caseStateBlock(state: InterviewState, validation: ValidationResult, today: string, userTurns: number) {
  const payload = {
    today,
    // The validation below describes the case *before* this message; these let the model
    // react to an amount or date given in this very message (the code re-validates after).
    rules: { small_claims_ceiling_ils: SMALL_CLAIMS_CEILING_ILS, limitation_years: LIMITATION_YEARS },
    case_file: toModel(state.caseFile),
    unknown_fields: state.unknownFields,
    validation: {
      issues: validation.issues,
      missing_required_fields: validation.missingRequired,
      can_draft: validation.canDraft,
      already_shown_to_user: state.raisedIssueCodes,
    },
    user_turns_so_far: userTurns,
    ...(userTurns >= MAX_INTERVIEW_TURNS
      ? { instruction: "The interview is long. Mark everything still missing as unknown and tell the user they can generate the draft." }
      : {}),
  };
  return `<case_state>\n${JSON.stringify(payload, null, 2)}\n</case_state>`;
}

export async function interviewTurn(messages: ChatMessage[], state: InterviewState): Promise<InterviewResult> {
  const today = todayInIsrael();
  const before = validateCase(state.caseFile, state.unknownFields, today);
  const userTurns = messages.filter((m) => m.role === "user").length;

  // History as plain text; the case state rides on the latest user message only.
  const last = messages[messages.length - 1];
  const apiMessages = [
    ...messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user" as const,
      content: `${caseStateBlock(state, before, today, userTurns)}\n\n<user_message>\n${last?.content ?? ""}\n</user_message>`,
    },
  ];

  const turn = await callStructured({
    system: loadPrompt("interview"),
    messages: apiMessages,
    schema: InterviewTurnSchema,
    effort: EFFORT.interview,
  });

  // Code owns the state: merge defensively, then validate the merged result.
  const caseFile = mergeCaseFile(state.caseFile, fromModel(turn.case_file));
  const reportedUnknown = turn.unknown_fields.filter((k): k is FieldKey => (FIELD_KEYS as readonly string[]).includes(k));
  const unknownFields = mergeUnknown(caseFile, state.unknownFields, reportedUnknown);
  const validation = validateCase(caseFile, unknownFields, today);

  // "core_missing" is just the interview being in progress — not worth a notice.
  const notices = validation.issues.filter((i) => i.code !== "core_missing" && !state.raisedIssueCodes.includes(i.code));
  const raisedIssueCodes = Array.from(new Set([...state.raisedIssueCodes, ...notices.map((n) => n.code)]));

  return {
    caseFile,
    unknownFields,
    raisedIssueCodes,
    assistantMessage: turn.assistant_message,
    notices,
    flags: turn.flags,
    nextQuestions: turn.next_questions,
    validation,
    fields: computeFieldStatuses(caseFile, unknownFields),
  };
}

// ───────────────────────────── Draft + Critic ─────────────────────────────

export type DraftResult = {
  draft: string;
  initialDraft: string;
  /** Issues found on the first draft (code checks + critic). */
  findings: DraftIssue[];
  criticSummary: string;
  revised: boolean;
  /** Issues still present after the automatic revision. */
  remaining: DraftIssue[];
  remainingSummary: string;
};

function caseBlock(caseFile: CaseFile, unknownFields: FieldKey[], validation: ValidationResult) {
  return `<case_file>\n${JSON.stringify(caseFile, null, 2)}\n</case_file>\n\n<unknown_fields>\n${JSON.stringify(unknownFields)}\n</unknown_fields>\n\n<validation_notes>\n${JSON.stringify(validation.issues, null, 2)}\n</validation_notes>`;
}

function stripFences(s: string) {
  return s.replace(/^```(?:markdown|md)?\s*\n/, "").replace(/\n```\s*$/, "").trim();
}

async function critique(draft: string, ctx: string, codeIssues: DraftIssue[], effort: "high" | "medium") {
  const res = await callStructured({
    system: loadPrompt("critic"),
    messages: [
      {
        role: "user",
        content: `${ctx}\n\n<code_checks>\n${JSON.stringify(codeIssues, null, 2)}\n</code_checks>\n\n<draft>\n${draft}\n</draft>`,
      },
    ],
    schema: CritiqueSchema,
    effort,
  });
  const criticIssues: DraftIssue[] = res.issues.map((i) => ({ ...i, source: "critic" }));
  return { issues: [...codeIssues, ...criticIssues], summary: res.summary };
}

export async function generateDraft(caseFile: CaseFile, unknownFields: FieldKey[]): Promise<DraftResult> {
  const today = todayInIsrael();
  const validation = validateCase(caseFile, unknownFields, today);
  if (validation.issues.some((i) => i.severity === "blocker")) {
    throw new Error("Cannot draft: the case file has blocking validation issues.");
  }
  const ctx = caseBlock(caseFile, unknownFields, validation);

  // 1. Draft
  const initialDraft = stripFences(
    await callText({ system: loadPrompt("draft"), messages: [{ role: "user", content: ctx }], effort: EFFORT.draft }),
  );

  // 2. Critic (separate call, separate prompt, sees only the case file + the draft)
  const first = await critique(initialDraft, ctx, checkDraft(initialDraft, caseFile), EFFORT.critic);
  if (first.issues.length === 0) {
    return { draft: initialDraft, initialDraft, findings: [], criticSummary: first.summary, revised: false, remaining: [], remainingSummary: first.summary };
  }

  // 3. Automatic revision
  const revisedDraft = stripFences(
    await callText({
      system: loadPrompt("revise"),
      messages: [
        {
          role: "user",
          content: `${ctx}\n\n<draft>\n${initialDraft}\n</draft>\n\n<issues>\n${JSON.stringify(first.issues, null, 2)}\n</issues>`,
        },
      ],
      effort: EFFORT.revise,
    }),
  );

  // 4. Re-check the revised draft so the user sees what (if anything) is left.
  const second = await critique(revisedDraft, ctx, checkDraft(revisedDraft, caseFile), "medium");

  return {
    draft: revisedDraft,
    initialDraft,
    findings: first.issues,
    criticSummary: first.summary,
    revised: true,
    remaining: second.issues,
    remainingSummary: second.summary,
  };
}
