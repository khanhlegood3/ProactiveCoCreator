/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GoogleGenAI,
  GenerateContentResponse,
  GenerateImagesResponse,
  Type,
  VideoGenerationReferenceType,
  ThinkingLevel,
  type ProxyHttpError,
  parseRetryAfterMs,
  getClientId,
} from "../genaiProxy";
import {
  AppMode,
  BeliefState,
  Clarification,
  Relationship,
  Entity,
  Attribute,
  ImagePart,
  StoryType,
  GeneratedImage,
  GraphUpdate,
  DomainBlueprint,
  GamePortalTrack,
  CryptoSolanaTrack,
  Language,
} from "../types";

const createAi = () => new GoogleGenAI({ apiKey: "server-side" });


export type StatusUpdateCallback = (message: string) => void;

class TransientModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientModelOutputError";
  }
}

/**
 * Determines whether a failed request or model response can succeed on retry,
 * covering HTTP 429/5xx statuses, transient browser fetch failures, and
 * truncated/empty structured JSON outputs.
 */
const isRetryableError = (error: any): boolean => {
  if (error instanceof TransientModelOutputError) {
    return true;
  }
  if (error?.name === "AbortError") {
    return false;
  }

  const rawMessage =
    typeof error?.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes("requested entity was not found") ||
    lower.includes("api_key_invalid") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_argument") ||
    lower.includes("disallowed model") ||
    lower.includes("untrusted request origin")
  ) {
    return false;
  }

  const status = Number((error as ProxyHttpError)?.status);
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  return (
    lower.includes('"code":503') ||
    lower.includes('"status":"unavailable"') ||
    lower.includes('"code":500') ||
    lower.includes('"status":"unknown"') ||
    lower.includes('"status":"deadline_exceeded"') ||
    lower.includes("rpc failed") ||
    lower.includes("xhr error") ||
    lower.includes("502") ||
    lower.includes("bad gateway") ||
    lower.includes("504") ||
    lower.includes("gateway timeout") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed") ||
    lower.includes("unexpected non-json response") ||
    lower.includes("rate limit") ||
    lower.includes('"code":429') ||
    lower.includes("status 429") ||
    lower.includes("status 500") ||
    lower.includes("status 502") ||
    lower.includes("status 503") ||
    lower.includes("status 504") ||
    lower.includes('"status":"resource_exhausted"') ||
    lower.includes("resource_exhausted")
  );
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  initialDelay = 1000,
  onStatusUpdate?: StatusUpdateCallback,
  actionName: string = "Request"
): Promise<T> => {
  let lastError: any;
  let currentDelay = initialDelay;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const canRetry = i < retries - 1 && isRetryableError(error);
      if (canRetry) {
        const msg = `Connection unstable or rate limited during ${actionName}. Retrying (${i + 1}/${retries - 1})...`;
        console.warn(msg, error);
        if (onStatusUpdate) onStatusUpdate(msg);

        const retryAfterMs = (error as ProxyHttpError)?.retryAfterMs;
        const waitMs =
          typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
            ? Math.max(retryAfterMs, currentDelay)
            : currentDelay;
        await delay(waitMs);
        currentDelay = Math.min(currentDelay * 2 + Math.floor(Math.random() * 600), 15_000);
      } else {
        break;
      }
    }
  }

  console.warn(`Request failed for ${actionName}:`, lastError);
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(
    `${actionName} failed: ${typeof lastError?.message === "string" ? lastError.message : "Unknown error"}`
  );
};

/**
 * Safely extracts non-thought text from a GenerateContentResponse without
 * throwing when `response.text` or candidate parts are undefined.
 */
function extractResponseText(response: GenerateContentResponse): string {
  if (typeof response?.text === "string" && response.text.trim()) {
    return response.text.trim();
  }
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts
      .filter((p: any) => typeof p?.text === "string" && !p?.thought)
      .map((p: any) => p.text)
      .join("")
      .trim();
    if (joined) return joined;
  }
  return "";
}

/**
 * Attempts to close truncated JSON strings/containers at the last safe boundary
 * when `MAX_TOKENS` cuts off a structured response mid-stream.
 */
function tryRepairTruncatedJson(input: string): any | null {
  const trimmed = input.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;

  // Walk characters tracking string state and open brackets, recording safe cut points.
  const stack: string[] = [];
  const safeCutIndices: { index: number; stackSnapshot: string[] }[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
        safeCutIndices.push({ index: i + 1, stackSnapshot: [...stack] });
      }
    } else if (ch === ",") {
      safeCutIndices.push({ index: i, stackSnapshot: [...stack] });
    }
  }

  for (let k = safeCutIndices.length - 1; k >= Math.max(0, safeCutIndices.length - 16); k--) {
    const { index, stackSnapshot } = safeCutIndices[k];
    const candidate = trimmed.slice(0, index) + [...stackSnapshot].reverse().join("");
    try {
      return JSON.parse(candidate);
    } catch {
      // Try an earlier safe boundary.
    }
  }
  return null;
}

/**
 * Parses structured JSON from model text output, stripping code fences,
 * isolating balanced JSON containers, and repairing truncated tails if needed.
 */
function parseModelJson<T>(rawText: string | undefined | null): T | null {
  if (typeof rawText !== "string") return null;
  let cleaned = rawText.trim();
  if (!cleaned) return null;

  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall through to balanced extraction / truncation repair.
  }

  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  let start = -1;
  if (firstObj !== -1 && firstArr !== -1) {
    start = Math.min(firstObj, firstArr);
  } else {
    start = Math.max(firstObj, firstArr);
  }
  if (start === -1) return null;

  const sliceFromStart = cleaned.slice(start);
  const closer = sliceFromStart[0] === "{" ? "}" : "]";
  const lastClose = sliceFromStart.lastIndexOf(closer);
  if (lastClose > 0) {
    try {
      return JSON.parse(sliceFromStart.slice(0, lastClose + 1)) as T;
    } catch {
      // Fall through to truncation repair.
    }
  }

  const repaired = tryRepairTruncatedJson(sliceFromStart);
  return repaired !== null ? (repaired as T) : null;
}

function normalizeAttribute(rawAttr: any): Attribute | null {
  if (!rawAttr || typeof rawAttr !== "object") return null;
  const name = typeof rawAttr.name === "string" ? rawAttr.name.trim() : "";
  if (!name) return null;
  const rawValues = Array.isArray(rawAttr.value)
    ? rawAttr.value
    : typeof rawAttr.value === "string"
      ? [rawAttr.value]
      : [];
  const value = rawValues
    .map((v: any) =>
      typeof v === "string"
        ? v.trim()
        : typeof v?.name === "string"
          ? v.name.trim()
          : ""
    )
    .filter(Boolean)
    .map((s: string) => ({ name: s }));
  return {
    name,
    presence_in_prompt: Boolean(rawAttr.presence_in_prompt),
    value: value.length > 0 ? value : [{ name: "Unknown" }],
  };
}

function normalizeEntity(rawEnt: any): Entity | null {
  if (!rawEnt || typeof rawEnt !== "object") return null;
  const name = typeof rawEnt.name === "string" ? rawEnt.name.trim() : "";
  if (!name) return null;
  const rawAlts = Array.isArray(rawEnt.alternatives) ? rawEnt.alternatives : [];
  const alternatives = rawAlts
    .map((s: any) =>
      typeof s === "string" ? s.trim() : typeof s?.name === "string" ? s.name.trim() : ""
    )
    .filter(Boolean)
    .map((s: string) => ({ name: s }));
  const rawAttrs = Array.isArray(rawEnt.attributes) ? rawEnt.attributes : [];
  const attributes = rawAttrs
    .map(normalizeAttribute)
    .filter((a: Attribute | null): a is Attribute => a !== null);

  return {
    name,
    presence_in_prompt: Boolean(rawEnt.presence_in_prompt),
    description: typeof rawEnt.description === "string" ? rawEnt.description : "",
    alternatives,
    attributes,
  };
}

function normalizeRelationship(rawRel: any): Relationship | null {
  if (!rawRel || typeof rawRel !== "object") return null;
  const source = typeof rawRel.source === "string" ? rawRel.source.trim() : "";
  const target = typeof rawRel.target === "string" ? rawRel.target.trim() : "";
  const label = typeof rawRel.label === "string" ? rawRel.label.trim() : "";
  if (!source || !target || !label) return null;
  const rawAlts = Array.isArray(rawRel.alternatives) ? rawRel.alternatives : [];
  const alternatives = rawAlts
    .map((s: any) =>
      typeof s === "string" ? s.trim() : typeof s?.name === "string" ? s.name.trim() : ""
    )
    .filter(Boolean)
    .map((s: string) => ({ name: s }));
  return {
    source,
    target,
    label,
    presence_in_prompt: Boolean(rawRel.presence_in_prompt),
    alternatives,
  };
}

function normalizeClarifications(raw: any): Clarification[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.clarifications)
      ? raw.clarifications
      : Array.isArray(raw?.questions)
        ? raw.questions
        : null;
  if (!list) return [];
  const result: Clarification[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const question = typeof item.question === "string" ? item.question.trim() : "";
    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const options = rawOptions
      .map((o: any) => (typeof o === "string" ? o.trim() : ""))
      .filter(Boolean);
    if (question && options.length > 0) {
      result.push({ question, options });
    }
  }
  return result;
}

/**
 * Generates the complete Belief Graph including Entities, Relationships, and Rich Attributes.
 */
export const parsePromptToBeliefGraph = async (
  prompt: string,
  mode: AppMode,
  onStatusUpdate?: StatusUpdateCallback,
  referenceImages: ImagePart[] = [],
  storyType: StoryType = "generic",
  proactiveness: "low" | "medium" | "high" = "medium",
  modelName: string = "gemini-3-flash-preview",
  domainTrack?: GamePortalTrack | CryptoSolanaTrack,
  language: Language = "vi"
): Promise<BeliefState> => {
  let modeSpecificInstructions = "";

  if (mode === "image") {
    modeSpecificInstructions = `
        - **The Image Entity:** Always include an entity named "The Image". Required Attributes: weather, location, time of day, atmosphere, camera angle, image style.
        `;
  } else if (mode === "video") {
    modeSpecificInstructions = `
        - **The Video Entity:** Always include an entity named "The Video". Required Attributes: camera_movement, lighting, atmosphere, video_style, pacing, duration_feel.
        `;
  } else if (mode === "game-portal") {
    modeSpecificInstructions = `
        - **The Game Portal Entity:** Always include an entity named "The Game Portal". Required Attributes: monetization_core (e.g., PlaytestCloud B2B, Poki Ads, Hybrid LiveOps), web_sdk_layer (e.g., Poki HTML5 Zero-Install, Embedded WebGL), gate_metrics (e.g., Crash Rate + Drop-off + D1 Retention), settlement_rail (e.g., USDC Escrow, USDT, Credit Card, Portal Credits), receipt_sync_policy (e.g., Deterministic Auto-Reconcile, Manual Review), target_market (e.g., TP.HCM / SEA, Los Angeles, Tokyo, Seoul), business_phase (e.g., Phase 1 Playtest B2B, Phase 2 Distribution & Tournaments). Track Focus: ${domainTrack || "playtest-b2b"}.
        `;
  } else if (mode === "crypto-solana") {
    modeSpecificInstructions = `
        - **The Protocol Entity:** Always include an entity named "The Protocol". Required Attributes: blockchain_network (Solana Mainnet-Beta / Devnet), launch_mechanism (e.g., Pump.fun Bonding Curve, Raydium AMM Graduation, Direct SPL), stablecoin_rails (e.g., USDC-SPL, USDT-SPL, Dual USDC/USDT), escrow_settlement (e.g., PDA Program Escrow, Instant Settlement), anti_sybil_gate (e.g., Proof-of-Play Receipt, Wallet Attestation), creator_fee_split (e.g., 1% Curve Fee, 0.5% Protocol / 0.5% Creator). Track Focus: ${domainTrack || "pumpfun-launch"}.
        `;
  } else if (storyType === "video-prompt") {
    modeSpecificInstructions = `
        - **The Video Script Entity:** Include an entity named "The Video Script". Required Attributes: camera_directions, visual_pacing, atmosphere, transition_style, cinematic_reference.
        `;
  } else {
    modeSpecificInstructions = `
        - **The Story Entity:** Always include an entity named "The Story". Required Attributes: genre, tone, narrative_perspective, pacing, central_conflict.
        `;
  }

  const universalEntityInstructions =
    mode === "game-portal"
      ? `
    - **Game Studios / Indie Devs:** Include: build_format (HTML5/WebGL), test_budget_tier, target_retention_gate, sdk_integration.
    - **Playtesters / Players:** Include: region (SEA/VN, US, JP, KR), payout_rail (USDC, USDT, Portal Credits), verification_method (Video+Telemetry, Receipt Hash).
    - **Payment / Escrow Rails:** Include: currency (USDC, USDT, Fiat Card), gateway_fee, settlement_latency, receipt_reconciliation_status.
    - **Games / LiveOps Products:** Include: genre (RPG, Drift/Racing, Casual), monetization_pack (Battle Pass, Gems Bundle, Qualifier Escrow), crash_rate_threshold, completion_gate.
    `
      : mode === "crypto-solana"
        ? `
    - **Tokens / Bonding Curves:** Include: token_standard (SPL / Token-2022), bonding_curve_target, graduation_dex (Raydium / PumpSwap), liquidity_lock.
    - **Stablecoin Escrow / Treasury:** Include: asset_pair (USDC / USDT), settlement_finality (400ms Solana), fee_overhead ($0.00025), release_condition (Receipt Verified).
    - **Wallets / Participants:** Include: role (Creator, Trader, Playtester, Studio), sybil_protection, custody_type (Phantom/Solflare PDA).
    - **Smart Contracts / Gates:** Include: program_type (Anchor PDA Escrow, Bonding Curve), audit_invariant, desync_fallback.
    `
        : `
    - **Humans:** For ANY human character, you **MUST** include these attributes: race/ethnicity, skin_tone, gender, age, hair_style, clothing_style (specific culture or fashion), facial_expression. 
    - **Animals (Cats, Dogs, etc.):** For ANY animal, you **MUST** include: specific_breed (e.g. Tabby, Golden Retriever), coat_color/pattern, age_stage (kitten, puppy, adult, senior), size, temperament.
    - **Objects (including Food/Meal):** Include: material, primary_color, condition, size, texture, cuisine_type (if food), cultural_origin.
    - **Locations:** Include: lighting_type, ambient_noise, temperature_vibe, architectural_style, geographic_region.
    `;

  const imageContextInstruction =
    referenceImages.length > 0
      ? `Reference image(s) have been provided. TREAT THE IMAGES AS THE SOURCE OF TRUTH for the current state of the scene. 
       - Map all visible entities, their relationships, and their visual attributes (especially race, breed, colors) accurately from the images.
       - Use the text prompt to identify INTENDED CHANGES or additions to this image state.`
      : `Analyze the text prompt to identify entities and their attributes.`;

  let proactivenessInstruction = "";
  let implicitEntitiesRule = "";
  let inferenceRule = "";
  let relationshipRule = "";

  if (proactiveness === "low") {
    proactivenessInstruction =
      "STRICT MODE: Only extract entities and attributes explicitly mentioned in the prompt. Do not invent or assume any details unless absolutely necessary for the medium.";
    implicitEntitiesRule =
      "**Implicit Entities:** Do NOT add implicit entities. Only include entities explicitly mentioned in the prompt.";
    inferenceRule =
      "**Inference Rule:** Do NOT infer values for unmentioned attributes unless absolutely required by the medium. Leave them as 'unspecified' or provide a minimal default.";
    relationshipRule =
      "**Infer Missing Connections:** Only include relationships explicitly stated in the prompt. Do not invent connections.";
  } else if (proactiveness === "medium") {
    proactivenessInstruction =
      "BALANCED MODE: Extract explicit entities and attributes, and infer reasonable defaults for missing critical attributes (like lighting or camera angle) to make a complete scene.";
    implicitEntitiesRule =
      "**Implicit Entities:** You may add 1-2 implicit entities that naturally and obviously belong in the scene.";
    inferenceRule =
      "**Inference Rule (Global Diversity):** If a mandatory attribute is not mentioned, infer a reasonable default based on context. Reflect global diversity in your inferred values (e.g., diverse races/ethnicities, cuisines).";
    relationshipRule =
      "**Infer Missing Connections:** Infer obvious missing connections (e.g., basic spatial relationships) that make the scene coherent.";
  } else {
    proactivenessInstruction =
      "CREATIVE MODE: Be highly proactive. Invent interesting, specific, and creative attributes for entities even if not mentioned. Add atmospheric and stylistic details to enhance the prompt.";
    implicitEntitiesRule =
      "**Implicit Entities:** Generate at least 3 implicit entities that are highly creative, potentially unlikely to appear but could be interesting to consider and creative.";
    inferenceRule =
      "**Inference Rule (Global Diversity):** If a mandatory attribute is not mentioned, you **MUST INFER** a plausible value or choose a specific, creative one. **DO NOT default to Western/US-centric norms.** Reflect global diversity.";
    relationshipRule =
      "**Infer Missing Connections:** If relationships are not explicitly stated, you **MUST IMAGINE** them. Consider spatial (next to, behind), emotional (loves, fears), or functional (holding, wearing) connections.";
  }

  const systemPrompt = `
    Analyze the prompt ${referenceImages.length > 0 ? "and reference images" : ""} and generate a complete **Belief Graph** representing the scene or story.
    Identify all entities, their detailed attributes, and their relationships.
    ${mode === "story" && storyType === "video-prompt" ? "YOU ARE AN EXPERT IN WRITING PROMPTS FOR VIDEOS." : ""}

    ${imageContextInstruction}
    
    ${proactivenessInstruction}

    ### ENTITY RULES:
    1.  **Core Entities:** Identify the core entities (objects, characters, setting).
    2.  **Absent Entities:** DO NOT extract entities that the prompt explicitly states are NOT present (e.g., "no party tables", "without sunlight"). Ignore them completely.
    3.  ${implicitEntitiesRule}
    4.  **Explicit vs Implicit:** 
        - If an entity is clearly stated in the prompt, set \`presence_in_prompt\` to \`true\`.
        - If you inferred it (e.g., a "table" in a "dining room" scene, but the prompt didn't mention a table), set \`presence_in_prompt\` to \`false\`.
    5.  **No Massive Strings:** DO NOT output any base64 strings, image data, or excessively long strings. Keep all descriptions and attribute values concise (1-6 words per candidate).

    ### CRITICAL ATTRIBUTE RULES:
    Attributes are the most important part of the graph. You must be specific and proactive.
    1.  **Existence:** For EVERY entity, you **MUST** include an attribute named 'existence' (value "true" or "false").
    2.  **No Meta-Attributes:** DO NOT create attributes that describe the graph structure or prompt status (e.g., 'presence_in_prompt', 'explicit', 'implicit', 'absent', 'mentioned'). These are structural properties of the schema, not visual attributes of the entity.
    3.  **Mandatory Category Attributes:**
        ${universalEntityInstructions}
    4.  **Mode Specific Scene Attributes:**
        ${modeSpecificInstructions}
    5.  ${inferenceRule}
    6.  **Candidates:** For EVERY attribute, provide 2-3 plausible alternative candidate values as a list of strings. The first value should be the most likely/current one.

    ### RELATIONSHIP RULES:
    1.  ${relationshipRule}
    2.  **Explicit vs Implicit:** 
        - If a relationship is clearly stated in the prompt, set \`presence_in_prompt\` to \`true\`.
        - If you inferred it (e.g., "a cat and a dog" implies they are "near" each other, but the prompt didn't say it), set \`presence_in_prompt\` to \`false\`.
    3.  **Quantity:** Identify AT LEAST 1 relationship for every pair of interacting entities. Do not leave entities isolated if they are part of the same scene.

    ### LANGUAGE RULE:
    - Active UI language: ${language === "vi" ? "Vietnamese (Tiếng Việt)" : "English"}.
    - Keep JSON schema field keys exact. Write entity names, descriptions, relationship labels, and candidate values in ${language === "vi" ? "natural Vietnamese (with standard English technical/domain terms where appropriate, or matching the user prompt)" : "English"} (except keep the root scene entity name as "The Image", "The Video", "The Game Portal", "The Protocol", "The Video Script", or "The Story" so the Attributes panel binds cleanly).

    Input Prompt: "${prompt}"`;

  const parts: any[] = [{ text: systemPrompt }];
  referenceImages.forEach((img) => parts.push(img));

  const attributeSchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      value: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["name", "presence_in_prompt", "value"],
  };

  const entitySchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      description: { type: Type.STRING },
      alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
      attributes: { type: Type.ARRAY, items: attributeSchema },
    },
    required: ["name", "presence_in_prompt", "description", "attributes"],
  };

  const relationshipSchema = {
    type: Type.OBJECT,
    properties: {
      source: { type: Type.STRING },
      target: { type: Type.STRING },
      label: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    },
    required: ["source", "target", "label", "presence_in_prompt"],
  };

  const ai = createAi();
  try {
    const generateAndParseWithModel = async (targetModel: string): Promise<BeliefState> => {
      return await withRetry<BeliefState>(
        async () => {
          const response = await ai.models.generateContent({
            model: targetModel,
            contents: { parts },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  entities: { type: Type.ARRAY, items: entitySchema },
                  relationships: { type: Type.ARRAY, items: relationshipSchema },
                },
                required: ["entities", "relationships"],
              },
              maxOutputTokens: 16384,
            },
          });

          const rawText = extractResponseText(response);
          if (!rawText) {
            throw new TransientModelOutputError("Model returned an empty belief graph response.");
          }
          const rawGraph = parseModelJson<any>(rawText);
          if (!rawGraph || typeof rawGraph !== "object") {
            throw new TransientModelOutputError("Model returned malformed belief graph JSON.");
          }

          const rawEntities = Array.isArray(rawGraph.entities) ? rawGraph.entities : [];
          const rawRelationships = Array.isArray(rawGraph.relationships)
            ? rawGraph.relationships
            : [];
          const entities = rawEntities
            .map(normalizeEntity)
            .filter((e: Entity | null): e is Entity => e !== null);
          const relationships = rawRelationships
            .map(normalizeRelationship)
            .filter((r: Relationship | null): r is Relationship => r !== null);

          return { entities, relationships, prompt };
        },
        3,
        2000,
        onStatusUpdate,
        `Belief Graph Generation (${targetModel})`
      );
    };

    try {
      return await generateAndParseWithModel(modelName);
    } catch (error: any) {
      console.warn(`Model ${modelName} failed for graph generation, falling back to Flash:`, error);
      if (modelName !== "gemini-3-flash-preview") {
        return await generateAndParseWithModel("gemini-3-flash-preview");
      }
      throw error;
    }
  } catch (error) {
    console.warn("Belief graph generation unavailable; using empty graph fallback:", error);
    return { entities: [], relationships: [], prompt };
  }
};

export const updateBeliefGraph = async (
  previousGraph: BeliefState,
  newPrompt: string,
  mode: AppMode,
  onStatusUpdate?: StatusUpdateCallback,
  referenceImages: ImagePart[] = [],
  storyType: StoryType = "generic",
  proactiveness: "low" | "medium" | "high" = "medium",
  modelName: string = "gemini-3-flash-preview",
  domainTrack?: GamePortalTrack | CryptoSolanaTrack,
  language: Language = "vi"
): Promise<BeliefState> => {
  let implicitEntitiesRule = "";
  let relationshipRule = "";

  if (proactiveness === "low") {
    implicitEntitiesRule =
      "11. IMPLICIT ENTITIES: Do NOT add new implicit entities unless absolutely necessary to connect explicit ones.";
    relationshipRule = "12. NEW RELATIONS: Only add relationships explicitly stated in the new prompt.";
  } else if (proactiveness === "medium") {
    implicitEntitiesRule =
      "11. IMPLICIT ENTITIES: You MUST ensure there are ALWAYS more than 1 implicit entities (presence_in_prompt: false) in the graph. If previous implicit entities were marked as absent or present, imagine new ones to replace them.";
    relationshipRule =
      "12. NEW RELATIONS: Imagine new relations, especially if an implicit entity with no edges got marked as present. Imagine what kind of relationship this entity may have with others.";
  } else {
    implicitEntitiesRule =
      "11. IMPLICIT ENTITIES: You MUST ensure there are ALWAYS more than 3 implicit entities (presence_in_prompt: false) in the graph. Be highly creative and imagine new implicit entities to replace any that were marked absent or present.";
    relationshipRule =
      "12. NEW RELATIONS: Imagine new, creative relations, especially if an implicit entity with no edges got marked as present. Imagine what kind of relationship this entity may have with others.";
  }

  const systemPrompt = `
    You are an expert at updating Belief Graphs.
    The user has updated their prompt or answered clarifications. Your task is to mutate the existing graph to reflect the new state.
    
    CRITICAL RULES:
    1. RENAME ENTITIES IF NEEDED: If an existing entity's core concept remains but its description in the prompt becomes more specific or changes (e.g., "Party Setting" becomes "Backyard Garden", or "Cat" becomes "Fluffy Cat"), you MUST rename it using the \`new_name\` field in \`update_entities\`. This preserves its connections while updating its label. Otherwise, KEEP EXISTING ENTITY NAMES EXACTLY THE SAME.
    2. ADD NEW ENTITIES: If the New Prompt introduces new objects, characters, or settings, you MUST add them as new entities using \`add_entities\`, and connect them to the graph using \`add_relationships\`.
    3. If a core concept changed, you MUST add new implicit entities that logically follow and update related attributes.
    4. If an implicit entity has now become explicit (presence_in_prompt becomes true), you MUST ensure it is connected to the rest of the graph. If it has no edges connected to it, you MUST add logical implicit edges (presence_in_prompt: false) connecting it to other relevant entities.
    5. DO NOT change the labels of existing relationships unless the new prompt explicitly contradicts them. Preserve the exact wording of existing relationship labels whenever possible.
    6. Explicit vs Implicit: If an entity or relationship is clearly stated in the New Prompt, set \`presence_in_prompt\` to \`true\`. If it is inferred (e.g., a "table" in a "party setup") or carried over but not explicitly mentioned in the new prompt, set it to \`false\`. Use \`update_entities\` and \`update_relationships\` to change the \`presence_in_prompt\` of existing entities and relationships.
    7. REMOVE ABSENT ENTITIES: If the New Prompt explicitly states that an entity is NOT present (e.g., "no party tables", "without sunlight"), or if an entity is completely removed from the prompt, you MUST completely remove that entity using \`remove_entities\`. Do NOT keep it in the graph with existence=false.
    8. NO META-ATTRIBUTES: DO NOT create or update attributes that describe the graph structure or prompt status (e.g., 'presence_in_prompt', 'explicit', 'implicit', 'absent', 'mentioned'). These are structural properties of the schema, not visual attributes of the entity.
    9. PRESERVE EXISTING ATTRIBUTES: DO NOT remove existing attributes unless they explicitly contradict the new prompt. Keep all existing attributes and their values intact, even if they are not explicitly mentioned in the new prompt. Use \`remove_attributes\` sparingly.
    10. EXTRACT ALL NEW ATTRIBUTES: If the new prompt adds new descriptive details (e.g., 'vibrant confetti', 'fluffy cat'), you MUST add or update the corresponding attributes in \`add_or_update_attributes\`. Be thorough.
    11. MINIMAL DELTA: ONLY output the entities and relationships that have changed. DO NOT output the entire graph. If an entity or relationship has not changed, DO NOT include it in the output.
    12. NO MASSIVE STRINGS: DO NOT output any base64 strings, image data, or excessively long strings. Keep all descriptions and attribute values concise (1-6 words per candidate).
    ${implicitEntitiesRule}
    ${relationshipRule}
    
    Previous Graph:
    ${JSON.stringify(previousGraph)}
    
    New Prompt: "${newPrompt}"
    
    Output a JSON patch to update the graph.
    `;

  const parts: any[] = [{ text: systemPrompt }];
  referenceImages.forEach((img) => parts.push(img));

  const attributeSchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      value: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["name", "presence_in_prompt", "value"],
  };

  const entitySchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      description: { type: Type.STRING },
      alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
      attributes: { type: Type.ARRAY, items: attributeSchema },
    },
    required: ["name", "presence_in_prompt", "description", "attributes"],
  };

  const relationshipSchema = {
    type: Type.OBJECT,
    properties: {
      source: { type: Type.STRING },
      target: { type: Type.STRING },
      label: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    },
    required: ["source", "target", "label", "presence_in_prompt"],
  };

  const deltaSchema = {
    type: Type.OBJECT,
    properties: {
      add_entities: { type: Type.ARRAY, items: entitySchema },
      remove_entities: { type: Type.ARRAY, items: { type: Type.STRING } },
      update_entities: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            new_name: { type: Type.STRING },
            description: { type: Type.STRING },
            presence_in_prompt: { type: Type.BOOLEAN },
            add_or_update_attributes: { type: Type.ARRAY, items: attributeSchema },
            remove_attributes: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["name"],
        },
      },
      add_relationships: { type: Type.ARRAY, items: relationshipSchema },
      remove_relationships: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            source: { type: Type.STRING },
            target: { type: Type.STRING },
          },
          required: ["source", "target"],
        },
      },
      update_relationships: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            source: { type: Type.STRING },
            target: { type: Type.STRING },
            label: { type: Type.STRING },
            presence_in_prompt: { type: Type.BOOLEAN },
          },
          required: ["source", "target"],
        },
      },
    },
  };

  const ai = createAi();
  try {
    const generateDeltaWithModel = async (targetModel: string): Promise<any> => {
      return await withRetry<any>(
        async () => {
          const response = await ai.models.generateContent({
            model: targetModel,
            contents: { parts },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: "application/json",
              responseSchema: deltaSchema,
              maxOutputTokens: 16384,
            },
          });

          const rawText = extractResponseText(response);
          if (!rawText) {
            throw new TransientModelOutputError(
              "Model returned an empty belief graph augmentation response."
            );
          }
          const parsed = parseModelJson<any>(rawText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new TransientModelOutputError(
              "Model returned malformed belief graph delta JSON."
            );
          }
          return parsed;
        },
        3,
        2000,
        onStatusUpdate,
        `Belief Graph Augmentation (${targetModel})`
      );
    };

    let delta: any;
    try {
      delta = await generateDeltaWithModel(modelName);
    } catch (error: any) {
      console.warn(`Model ${modelName} failed for graph augmentation, falling back to Flash:`, error);
      if (modelName !== "gemini-3-flash-preview") {
        delta = await generateDeltaWithModel("gemini-3-flash-preview");
      } else {
        throw error;
      }
    }

    let newEntities = [...(previousGraph.entities || [])];
    let newRelationships = [...(previousGraph.relationships || [])];

    if (Array.isArray(delta.remove_entities)) {
      const removedSet = new Set(
        delta.remove_entities.filter((n: any): n is string => typeof n === "string")
      );
      newEntities = newEntities.filter((e) => !removedSet.has(e.name));
      newRelationships = newRelationships.filter(
        (r) => !removedSet.has(r.source) && !removedSet.has(r.target)
      );
    }

    if (Array.isArray(delta.add_entities)) {
      delta.add_entities.forEach((rawEnt: any) => {
        const normalized = normalizeEntity(rawEnt);
        if (normalized && !newEntities.some((e) => e.name === normalized.name)) {
          newEntities.push(normalized);
        }
      });
    }

    if (Array.isArray(delta.update_entities)) {
      delta.update_entities.forEach((update: any) => {
        if (!update || typeof update.name !== "string") return;
        const entityIndex = newEntities.findIndex((e) => e.name === update.name);
        if (entityIndex === -1) return;

        const entity = { ...newEntities[entityIndex] };
        if (typeof update.description === "string") entity.description = update.description;
        if (typeof update.presence_in_prompt === "boolean") {
          entity.presence_in_prompt = update.presence_in_prompt;
        }

        let newAttributes = [...(entity.attributes || [])];
        if (Array.isArray(update.remove_attributes)) {
          const removeAttrSet = new Set(
            update.remove_attributes.filter((n: any): n is string => typeof n === "string")
          );
          newAttributes = newAttributes.filter((a) => !removeAttrSet.has(a.name));
        }
        if (Array.isArray(update.add_or_update_attributes)) {
          update.add_or_update_attributes.forEach((rawAttr: any) => {
            const parsedAttr = normalizeAttribute(rawAttr);
            if (!parsedAttr) return;
            const attrIndex = newAttributes.findIndex((a) => a.name === parsedAttr.name);
            if (attrIndex !== -1) {
              newAttributes[attrIndex] = parsedAttr;
            } else {
              newAttributes.push(parsedAttr);
            }
          });
        }
        entity.attributes = newAttributes;

        if (typeof update.new_name === "string" && update.new_name.trim() && update.new_name !== entity.name) {
          const nextName = update.new_name.trim();
          const oldName = entity.name;
          entity.name = nextName;

          newRelationships = newRelationships.map((rel) => {
            if (rel.source === oldName) return { ...rel, source: nextName };
            if (rel.target === oldName) return { ...rel, target: nextName };
            return rel;
          });
        }

        newEntities[entityIndex] = entity;
      });
    }

    if (Array.isArray(delta.remove_relationships)) {
      delta.remove_relationships.forEach((rm: any) => {
        if (!rm || typeof rm.source !== "string" || typeof rm.target !== "string") return;
        newRelationships = newRelationships.filter(
          (r) => !(r.source === rm.source && r.target === rm.target)
        );
      });
    }

    if (Array.isArray(delta.add_relationships)) {
      delta.add_relationships.forEach((rawRel: any) => {
        const normalized = normalizeRelationship(rawRel);
        if (!normalized) return;
        const index = newRelationships.findIndex(
          (existing) => existing.source === normalized.source && existing.target === normalized.target
        );
        if (index === -1) {
          newRelationships.push(normalized);
        } else {
          newRelationships[index] = {
            ...newRelationships[index],
            ...normalized,
            alternatives:
              normalized.alternatives && normalized.alternatives.length > 0
                ? normalized.alternatives
                : newRelationships[index].alternatives,
          };
        }
      });
    }

    if (Array.isArray(delta.update_relationships)) {
      delta.update_relationships.forEach((update: any) => {
        if (!update || typeof update.source !== "string" || typeof update.target !== "string") return;
        const index = newRelationships.findIndex(
          (existing) => existing.source === update.source && existing.target === update.target
        );
        if (index !== -1) {
          newRelationships[index] = {
            ...newRelationships[index],
            ...(typeof update.label === "string" && update.label.trim()
              ? { label: update.label.trim() }
              : {}),
            ...(typeof update.presence_in_prompt === "boolean"
              ? { presence_in_prompt: update.presence_in_prompt }
              : {}),
          };
        }
      });
    }

    return {
      entities: newEntities,
      relationships: newRelationships,
      prompt: newPrompt,
    };
  } catch (error) {
    console.warn("Belief graph augmentation failed; falling back to full regeneration:", error);
    if (onStatusUpdate) {
      onStatusUpdate(
        language === "vi"
          ? "Không thể bổ sung đồ thị. Đang tạo lại toàn bộ đồ thị."
          : "Failed to augment graph. Falling back to full regeneration."
      );
    }
    return parsePromptToBeliefGraph(
      newPrompt,
      mode,
      onStatusUpdate,
      referenceImages,
      storyType,
      proactiveness,
      modelName,
      domainTrack,
      language
    );
  }
};

export const generateClarifications = async (
  prompt: string,
  askedQuestions: string[],
  mode: AppMode,
  onStatusUpdate?: StatusUpdateCallback,
  referenceImages: ImagePart[] = [],
  storyType: StoryType = "generic",
  model: string = "gemini-3-flash-preview",
  proactiveness: "low" | "medium" | "high" = "medium",
  domainTrack?: GamePortalTrack | CryptoSolanaTrack,
  language: Language = "vi"
): Promise<Clarification[]> => {
  const ai = createAi();

  const imagePrompt = `You are an expert in text-to-image prompting. Help a user refine their prompt (and images if provided) by asking clarifying questions.`;
  const videoPrompt = `You are an expert in AI video generation prompting. Help a user refine their prompt (and images if provided) by asking clarifying questions.`;
  const genericStoryPrompt = `You are a creative writing assistant. Help a user develop their story idea from the prompt (and images if provided) by asking insightful clarifying questions.`;
  const videoPromptStoryPrompt = `You are an expert in writing prompts for AI video generators. Analyze the vision and ask questions to help produce a highly detailed visual video prompt.`;
  const gamePortalPrompt = `You are a Principal Game Portal & Playtest Strategist specializing in Game9K (combining PlaytestCloud B2B playtesting + receipt gates, Poki no-install HTML5 web SDK, and Voodoo quantitative gate metrics, plus USDC/USDT stablecoin escrow rails). Focus track: ${domainTrack || "playtest-b2b"}. Respond in the same language as the user's prompt (e.g., Vietnamese if the prompt is in Vietnamese). Help clarify pricing tiers, Voodoo gate thresholds, receipt sync SLAs, and Phase 1 -> Phase 2 conversion.`;
  const cryptoSolanaPrompt = `You are a Principal Solana Blockchain & Pump.fun Tokenomics Architect specializing in bonding curves, Raydium/PumpSwap graduation, SPL tokens, and zero-fee USDC/USDT PDA escrow settlement. Focus track: ${domainTrack || "pumpfun-launch"}. Respond in the same language as the user's prompt (e.g., Vietnamese if the prompt is in Vietnamese). Help clarify bonding curve mechanics, creator fee splits, USDC/USDT escrow invariants, and anti-sybil verification.`;

  let specificPrompt = imagePrompt;
  if (mode === "story") {
    specificPrompt = storyType === "video-prompt" ? videoPromptStoryPrompt : genericStoryPrompt;
  } else if (mode === "video") {
    specificPrompt = videoPrompt;
  } else if (mode === "game-portal") {
    specificPrompt = gamePortalPrompt;
  } else if (mode === "crypto-solana") {
    specificPrompt = cryptoSolanaPrompt;
  }

  const imageInstruction =
    referenceImages.length > 0
      ? `IMPORTANT: Reference images have been provided. 
       - DO NOT ask about visual details that are clearly visible and unambiguous in the images.
       - DO ask questions that clarify the INTENT behind the text prompt's modifications to the images.
       - Focus on unresolved ambiguities between the text and the images.`
      : `Analyze the text prompt to find ambiguities.`;

  let proactivenessInstruction = "";
  if (proactiveness === "low") {
    proactivenessInstruction =
      "STRICT MODE: Only ask about the attributes of existing entities explicitly mentioned in the prompt, or the attributes of the main medium (image/story/video). Do NOT invent story elements or suggest creative additions.";
  } else if (proactiveness === "medium") {
    proactivenessInstruction =
      "BALANCED MODE: Ask about missing technical details and offer a few creative suggestions that stay close to the original prompt's intent.";
  } else {
    proactivenessInstruction =
      "CREATIVE MODE: Be highly proactive and very creative. Suggest wild, creative additions, new characters, unexpected twists, or unique stylistic choices to enhance the prompt.";
  }

  const diversityInstruction = `
    ### CRITICAL INSTRUCTIONS FOR QUALITY & SIMPLICITY:
    1. **Be Naturally Curious:** Imagine you are a creative partner trying to visualize the user's idea. What are the most important missing details? Ask the 3 most critical questions that will have the biggest impact on the final result.
    2. **Atomic Questions:** Ask ONE specific thing per question. **NEVER** combine two topics. 
       - **Correct:** "What is the lighting style?"
       - **Incorrect:** "What is the lighting and the background?" (This is confusing).
       - Keep questions **short** and **easy to read**.
    3. **Global Context:** Users are global. Do not assume Western norms (e.g., "breakfast" != pancakes). If cultural context is ambiguous, ask about it.
    4. **Diversity of Topics:** Do NOT ask 3 questions about the same topic (e.g., don't ask 3 questions just about lighting). Mix up the types of questions (e.g., one about the subject, one about the mood, one about the style) to get a full picture.
    5. **Forbidden Topics:** In ANY mode, NEVER ask about the aspect ratio or resolution.
    
    ${proactivenessInstruction}
    `;

  const finalPrompt =
    specificPrompt +
    `
    
    ${imageInstruction}

    ${diversityInstruction}

Follow these instructions EXACTLY:
1.  **Quantity:** Generate EXACTLY 3 questions.
2.  **Clarity:** Questions must be simple, single-topic, and direct.
3.  **Ease:** Provide 3-5 plausible options covering DIVERSE possibilities.
4.  **Avoid Repetition**: DO NOT ask any of:
    ${askedQuestions.map((q) => `- "${q}"`).join("\n") || "N/A"}
5.  **Output Language**: Write all clarifying questions and answer options in ${language === "vi" ? "clear, natural Vietnamese (keeping standard technical terms like USDC, PDA, SDK, Bonding Curve where helpful)" : "clear, natural English"}.

User Prompt: "${prompt}"`;

  const parts: any[] = [{ text: finalPrompt }];
  referenceImages.forEach((img) => parts.push(img));

  const generateClarificationsWithModel = async (targetModel: string): Promise<Clarification[]> => {
    return await withRetry<Clarification[]>(
      async () => {
        const response = await ai.models.generateContent({
          model: targetModel,
          contents: { parts },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["question", "options"],
              },
            },
            maxOutputTokens: 16384,
          },
        });

        const rawText = extractResponseText(response);
        if (!rawText) {
          throw new TransientModelOutputError("Model returned an empty clarifications response.");
        }
        const parsed = parseModelJson<any>(rawText);
        const normalized = normalizeClarifications(parsed);
        if (normalized.length === 0) {
          throw new TransientModelOutputError("Model returned malformed clarifications JSON.");
        }
        return normalized;
      },
      4,
      2000,
      onStatusUpdate,
      `Clarification Generation (${targetModel})`
    );
  };

  try {
    try {
      return await generateClarificationsWithModel(model);
    } catch (error: any) {
      if (model !== "gemini-3-flash-preview") {
        console.warn(`Model ${model} failed for clarifications, falling back to Flash:`, error);
        return await generateClarificationsWithModel("gemini-3-flash-preview");
      }
      throw error;
    }
  } catch (error) {
    console.warn("Clarifications unavailable; returning empty list:", error);
    return [];
  }
};

export const refinePromptWithAllUpdates = async (
  originalPrompt: string,
  clarifications: { question: string; answer: string }[],
  graphUpdates: GraphUpdate[],
  onStatusUpdate?: StatusUpdateCallback,
  proactiveness: "low" | "medium" | "high" = "medium",
  language: Language = "vi"
): Promise<string> => {
  const ai = createAi();
  let updatesPromptSection = "";
  if (graphUpdates.length > 0) {
    const graphList = graphUpdates
      .map((u) => {
        if (u.type === "attribute") {
          if (
            u.attribute.toLowerCase() === "existence" ||
            u.attribute.toLowerCase() === "existence_in_image"
          ) {
            if (u.value === "false") {
              return `- REMOVE entity "${u.entity}" from the prompt entirely, or explicitly state it is not present.`;
            }
            return `- ENSURE entity "${u.entity}" is explicitly mentioned in the prompt.`;
          }
          return `- For entity "${u.entity}", set attribute "${u.attribute}" to "${u.value}".`;
        }
        return `- Change relationship between "${u.source}" and "${u.target}" from "${u.oldLabel}" to "${u.newLabel}".`;
      })
      .join("\n");
    updatesPromptSection += `\nSPECIFIC EDITS TO APPLY:\n${graphList}\n`;
  }

  if (clarifications.length > 0) {
    const qaList = clarifications
      .map((c) => `- User Answer to "${c.question}": "${c.answer}"`)
      .join("\n");
    updatesPromptSection += `\nNEW INFORMATION FROM Q&A:\n${qaList}\n`;
  }

  let proactivenessInstruction = "";
  if (proactiveness === "low") {
    proactivenessInstruction =
      "STRICT MODE: Only apply the exact edits requested. Do not change the tone, style, or add any unrequested details.";
  } else if (proactiveness === "medium") {
    proactivenessInstruction =
      "BALANCED MODE: Apply the edits smoothly. You may slightly adjust wording for flow, but keep the core meaning intact. DO NOT add unrequested details.";
  } else {
    proactivenessInstruction =
      "CREATIVE MODE: Apply the edits and feel free to embellish the prompt with richer descriptive language, enhancing the atmosphere and style, BUT DO NOT omit any requested edits.";
  }

  const promptMessage = `Rewrite the prompt to incorporate specific user edits while strictly preserving all other existing details.
    
Original Prompt: "${originalPrompt}"

${updatesPromptSection}

CRITICAL INSTRUCTIONS:
1. Integrate all specific edits and answers into a single, cohesive, descriptive prompt.
2. STRICTLY PRESERVE all existing details from the Original Prompt that are not explicitly changed by the edits. Do NOT omit existing entities, attributes, or relationships.
3. DO NOT add any new unrequested details, entities, or actions unless explicitly answering a "[YOU DECIDE]" question.
4. If an edit says to REMOVE an entity, ensure all references to it are completely removed from the prompt, or explicitly state it is absent.
5. If a user explicitly answers "[NOT RELEVANT]", do NOT include any details about that topic.
6. YOUR ENTIRE RESPONSE MUST ONLY BE THE FINAL REFINED PROMPT TEXT.
7. DO NOT INCLUDE ANY LABELS, PREFIXES, OR FORMATTING LIKE "Updated Prompt:", "Refined Prompt:", or "**Updated Prompt:**".
8. DO NOT provide any conversational intro or outro.
9. DO NOT use markdown bolding for the whole prompt.
10. Write the final refined prompt in ${language === "vi" ? "Vietnamese (or matching the Original Prompt language if clearly written in English)" : "English (or matching the Original Prompt language if clearly written in Vietnamese)"}.

${proactivenessInstruction}

Output the refined prompt text now:`;

  try {
    const response = await withRetry<GenerateContentResponse>(
      () =>
        ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: promptMessage,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              "You are a prompt engineering expert. Your task is to rewrite user prompts based on provided updates. You MUST output ONLY the final refined text of the prompt. No prefixes, no suffixes, no 'Updated Prompt' labels. Just the prompt itself.",
            temperature: 0.2,
          },
        }),
      3,
      1000,
      onStatusUpdate,
      "Prompt Refinement (gemini-3-flash-preview)"
    );

    let refined = extractResponseText(response) || originalPrompt;
    refined = refined.replace(/^[\s\W]*(updated|refined|final|new)\s*prompt\s*[:\s-]+/i, "");
    refined = refined.replace(/^\**Updated Prompt:\**\s*/i, "");
    refined = refined.replace(/^\**Refined Prompt:\**\s*/i, "");
    refined = refined.replace(/^Prompt:\s*/i, "");
    refined = refined.trim();

    return refined || originalPrompt;
  } catch (error) {
    console.warn("Prompt refinement unavailable; keeping original prompt:", error);
    return originalPrompt;
  }
};

export const generateImagesFromPrompt = async (
  prompt: string,
  onStatusUpdate?: StatusUpdateCallback,
  referenceImages: ImagePart[] = [],
  aspectRatio: string = "16:9",
  model: string = "gemini-2.5-flash-image",
  imageSize: string = "1K"
): Promise<GeneratedImage[]> => {
  const ai = createAi();

  if (model.startsWith("imagen-")) {
    const response = await withRetry<GenerateImagesResponse>(
      () =>
        ai.models.generateImages({
          model,
          prompt,
          config: {
            numberOfImages: 4,
            aspectRatio: aspectRatio as any,
            outputMimeType: "image/jpeg",
          },
        }),
      3,
      2000,
      onStatusUpdate,
      "Imagen Generation"
    );

    const rawImages = Array.isArray(response?.generatedImages) ? response.generatedImages : [];
    const mapped = rawImages
      .filter((img: any) => typeof img?.image?.imageBytes === "string" && img.image.imageBytes)
      .map((img: any) => ({
        url: `data:${img.image.mimeType || "image/jpeg"};base64,${img.image.imageBytes}`,
      }));

    if (mapped.length === 0) {
      throw new Error(
        "No images were returned. The prompt may have been filtered by safety checks."
      );
    }
    return mapped;
  }

  const generateOne = async (): Promise<{ imageUrl: string | null; refusal?: string }> => {
    try {
      const parts: any[] = [{ text: prompt }];
      referenceImages.forEach((img) => parts.push(img));

      const imageConfig: any = {
        aspectRatio,
        imageSize:
          model === "gemini-3-pro-image-preview" || model === "gemini-3.1-flash-image-preview"
            ? imageSize
            : undefined,
      };

      const response = await withRetry<GenerateContentResponse>(
        () =>
          ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              imageConfig,
              responseModalities: ["IMAGE"],
            },
          }),
        3,
        2000,
        onStatusUpdate,
        "Image Generation"
      );

      let refusalText = "";
      const candidateParts = response?.candidates?.[0]?.content?.parts;
      if (Array.isArray(candidateParts)) {
        for (const part of candidateParts) {
          if (part?.inlineData?.data) {
            return {
              imageUrl: `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`,
            };
          }
          if (typeof part?.text === "string" && !part?.thought) {
            refusalText += part.text;
          }
        }
      }

      const finishReason = response?.candidates?.[0]?.finishReason;
      if (!refusalText && finishReason && finishReason !== "STOP") {
        refusalText = `Image generation stopped (${finishReason}).`;
      }

      return { imageUrl: null, refusal: refusalText.trim() || undefined };
    } catch (err: any) {
      console.warn("Single image generation failed:", err);
      const errMsg = typeof err?.message === "string" ? err.message : undefined;
      return { imageUrl: null, refusal: errMsg };
    }
  };

  const validImages: GeneratedImage[] = [];
  const errors: string[] = [];
  let attempts = 0;
  const maxAttempts = 2;
  const batchConcurrency = 2;

  while (validImages.length < 4 && attempts < maxAttempts) {
    const needed = 4 - validImages.length;
    let cursor = 0;
    const batchResults: { imageUrl: string | null; refusal?: string }[] = [];

    const workers = Array.from({ length: Math.min(batchConcurrency, needed) }, async () => {
      while (cursor < needed) {
        cursor += 1;
        batchResults.push(await generateOne());
      }
    });
    await Promise.all(workers);

    batchResults.forEach((res) => {
      if (res.imageUrl && validImages.length < 4) {
        validImages.push({ url: res.imageUrl });
      } else if (res.refusal) {
        errors.push(res.refusal);
      }
    });
    attempts++;
  }

  const results: GeneratedImage[] = [...validImages];
  while (results.length < 4 && errors.length > 0) {
    results.push({ url: null, error: errors.shift() });
  }

  if (validImages.length === 0 && results.length === 0) {
    throw new Error(errors[0] || "Image generation failed.");
  }
  return results;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string" && reader.result) {
        resolve(reader.result);
      } else {
        resolve(URL.createObjectURL(blob));
      }
    };
    reader.onerror = () => resolve(URL.createObjectURL(blob));
    reader.readAsDataURL(blob);
  });

export const generateVideosFromPrompt = async (
  prompt: string,
  onStatusUpdate?: StatusUpdateCallback,
  referenceImages: ImagePart[] = [],
  aspectRatio: string = "16:9",
  model: string = "gemini-omni-1.2-flash",
  resolution: string = "720p",
  language: Language = "vi"
): Promise<string> => {
  const ai = createAi();
  if (onStatusUpdate) {
    onStatusUpdate(
      language === "vi"
        ? "Đang khởi tạo tạo video (có thể mất 1-2 phút)..."
        : "Initializing video generation (this may take 1-2 minutes)..."
    );
  }

  const videoParameters: any = {
    model,
    prompt,
    config: {
      numberOfVideos: 1,
      resolution,
      aspectRatio: aspectRatio === "9:16" || aspectRatio === "16:9" ? aspectRatio : "16:9",
    },
  };

  if (referenceImages.length > 0) {
    const invalidImage = referenceImages.find(
      (img) => !["image/jpeg", "image/png", "image/webp"].includes(img.inlineData.mimeType)
    );
    if (invalidImage) {
      throw new Error(
        `Video generation supports JPEG, PNG, and WEBP reference images. Found: ${invalidImage.inlineData.mimeType}.`
      );
    }

    if (referenceImages.length > 1) {
      const limitedImages = referenceImages.slice(0, 3);
      videoParameters.config.referenceImages = limitedImages.map((img) => ({
        image: {
          imageBytes: img.inlineData.data,
          mimeType: img.inlineData.mimeType,
        },
        referenceType: VideoGenerationReferenceType.ASSET,
      }));
    } else {
      videoParameters.image = {
        imageBytes: referenceImages[0].inlineData.data,
        mimeType: referenceImages[0].inlineData.mimeType,
      };
    }
  }

  let operation = await withRetry(
    () => ai.models.generateVideos(videoParameters),
    2,
    2000,
    onStatusUpdate,
    "Video Generation Start"
  );

  let pollCount = 0;
  let consecutivePollFailures = 0;
  const maxPolls = 36;
  while (!operation.done && pollCount < maxPolls) {
    pollCount++;
    await delay(10000);
    if (onStatusUpdate) {
      onStatusUpdate(
        language === "vi"
          ? "Đang tạo khung hình video (có thể mất vài phút)..."
          : "Generating video frames (this may take a few minutes)..."
      );
    }
    try {
      operation = await ai.operations.getVideosOperation({ operation });
      consecutivePollFailures = 0;
    } catch (e: any) {
      consecutivePollFailures++;
      const status = Number((e as ProxyHttpError)?.status);
      const msg = e instanceof Error ? e.message : String(e);
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        /\bstatus (?:400|401|403|404)\b|not found on server/i.test(msg) ||
        consecutivePollFailures >= 3
      ) {
        throw e instanceof Error ? e : new Error("Failed to check video generation status.");
      }
      const retryWait = (e as ProxyHttpError)?.retryAfterMs;
      if (typeof retryWait === "number" && retryWait > 0) {
        await delay(retryWait);
      }
    }
  }

  if (!operation.done) {
    throw new Error("Video generation timed out. Please try again.");
  }

  if (operation.error) {
    throw new Error(
      `Video generation failed: ${operation.error.message || JSON.stringify(operation.error)}`
    );
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    const responseAny = operation.response as any;
    if (
      Array.isArray(responseAny?.raiMediaFilteredReasons) &&
      responseAny.raiMediaFilteredReasons.length > 0
    ) {
      throw new Error(responseAny.raiMediaFilteredReasons[0]);
    }
    throw new Error(
      "No video URI returned. The request may have been blocked by safety filters or failed."
    );
  }

  const response = await fetch(videoUri, { headers: { "x-client-id": getClientId() } });
  if (!response.ok) {
    const retryWait = parseRetryAfterMs(response.headers.get("retry-after"));
    if (response.status === 429 && retryWait) {
      await delay(retryWait);
      const retryRes = await fetch(videoUri, { headers: { "x-client-id": getClientId() } });
      if (retryRes.ok) {
        const retryBlob = await retryRes.blob();
        return await blobToDataUrl(retryBlob);
      }
    }
    const errorText = await response.text().catch(() => "");
    const safeDetail =
      errorText && !errorText.trim().startsWith("<") ? ` Details: ${errorText.slice(0, 200)}` : "";
    throw new Error(`Failed to download video (status ${response.status}).${safeDetail}`);
  }

  const blob = await response.blob();
  return await blobToDataUrl(blob);
};

export const generateStoryFromPrompt = async (
  prompt: string,
  onStatusUpdate?: StatusUpdateCallback,
  referenceImages: ImagePart[] = [],
  model: string = "gemini-3-flash-preview",
  storyType: StoryType = "generic",
  language: Language = "vi"
): Promise<string> => {
  const ai = createAi();
  const langNote = language === "vi" ? "Write the response in natural Vietnamese." : "Write the response in natural English.";

  let instruction = `Write a short, creative story based on the prompt (and images if provided). ${langNote} Idea: "${prompt}"`;
  if (storyType === "video-prompt") {
    instruction = `YOU ARE AN EXPERT IN WRITING PROMPTS FOR AI VIDEO GENERATORS. 
        Your task is to take the user's idea "${prompt}" and rewrite it into a detailed, highly visual, cinematic video generation prompt. 
        Describe camera movements, lighting, materials, and specific actions. 
        Keep the output as a single paragraph dense with visual information. ${langNote}`;
  }

  const parts: any[] = [{ text: instruction }];
  referenceImages.forEach((img) => parts.push(img));

  return await withRetry<string>(
    async () => {
      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          temperature: 0.8,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const storyText = extractResponseText(response);
      if (!storyText) {
        const finishReason = response?.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
          throw new Error(`Story generation was blocked (${finishReason}).`);
        }
        throw new TransientModelOutputError("Model returned an empty story response.");
      }
      return storyText;
    },
    3,
    1000,
    onStatusUpdate,
    "Story Generation"
  );
};

export const generateDomainBlueprint = async (
  prompt: string,
  domain: "game-portal" | "crypto-solana",
  onStatusUpdate?: StatusUpdateCallback,
  model: string = "gemini-3-flash-preview",
  track?: GamePortalTrack | CryptoSolanaTrack,
  language: Language = "vi"
): Promise<DomainBlueprint> => {
  const ai = createAi();

  const domainContext =
    domain === "game-portal"
      ? `You are designing a production-ready operational & monetization blueprint for **Game9K (Game Portal)** combining:
1. **PlaytestCloud** (core early monetization: B2B playtesting + transparent video/telemetry receipt portal).
2. **Poki** (no-install HTML5/WebGL SDK layer like poki/netlib & poki/npm-sdk for zero-friction browser entry).
3. **Voodoo** (strict quantitative gate metrics: crash rate, level drop-off, session completion rate, D1/D7 retention — without burning massive UA ad budgets).
Ground every recommendation in the verified 2026 Game Portal operating baseline ($1,314.87 / 12 orders; TP.HCM leading $314.98 / 3 orders, LA $298.90, Tokyo $264.00, Seoul $239.00; USDC $518.00 + USDT $288.99 = 61.4% share vs Credit Card $402.90 & Portal Credits $104.98; 2/12 Delayed Delivery desync incidents GP-2026-9022 USDT TP.HCM & GP-2026-9014 Card Tokyo; CyberQuest RPG $353.99, Drift Horizon $298.90, Pro League Qualifier USDC Escrow $249, 12,000 Cyber Gems $99.99).
Track Focus: ${track || "playtest-b2b"}.`
      : `You are designing a production-ready technical & tokenomics blueprint for **Crypto Pump.fun, Solana Blockchain & USDT/USDC Settlement**:
1. **Pump.fun Bonding Curve & Graduation**: Fair-launch SPL/Token-2022 curve dynamics, market-cap graduation threshold to Raydium/PumpSwap, creator fee routing, anti-rug liquidity invariants.
2. **Solana Blockchain High-Throughput Rails**: <400ms finality, ~$0.00025 tx fees, Anchor PDA escrow accounts, deterministic event indexing.
3. **USDT-SPL & USDC-SPL Payment/Escrow Rails**: Zero gateway fees (compared to 2.9%+$0.30 cards), instant split payouts for Game9K playtesters, studio B2B escrow, and tournament prize pools (e.g., $249 Pro League Qualifier USDC Escrow) with automated receipt verification to prevent delayed-delivery desyncs.
Track Focus: ${track || "pumpfun-launch"}.`;

  const instruction = `${domainContext}

Write all JSON field values in ${language === "vi" ? "clear, natural Vietnamese (with standard technical terms like USDC, SPL, PDA, SDK, Bonding Curve)" : "clear, natural English"}.
Keep every item concrete, quantitative, and actionable (no vague fluff).

User Specification Prompt: "${prompt}"`;

  const blueprintSchema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      executiveSummary: { type: Type.STRING },
      architecturePhases: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            phase: { type: Type.STRING },
            objective: { type: Type.STRING },
            stack: { type: Type.STRING },
            revenueModel: { type: Type.STRING },
          },
          required: ["phase", "objective", "stack", "revenueModel"],
        },
      },
      tiersOrTokenomics: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            priceOrFee: { type: Type.STRING },
            deliverables: { type: Type.STRING },
            settlementRail: { type: Type.STRING },
          },
          required: ["name", "targetAudience", "priceOrFee", "deliverables", "settlementRail"],
        },
      },
      gateCriteria: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            metric: { type: Type.STRING },
            threshold: { type: Type.STRING },
            sourceBenchmark: { type: Type.STRING },
            actionOnFail: { type: Type.STRING },
          },
          required: ["metric", "threshold", "sourceBenchmark", "actionOnFail"],
        },
      },
      escrowAndReceiptFlow: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      risks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            risk: { type: Type.STRING },
            evidence: { type: Type.STRING },
            mitigation: { type: Type.STRING },
          },
          required: ["risk", "evidence", "mitigation"],
        },
      },
      nextActions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
    required: [
      "title",
      "executiveSummary",
      "architecturePhases",
      "tiersOrTokenomics",
      "gateCriteria",
      "escrowAndReceiptFlow",
      "risks",
      "nextActions",
    ],
  };

  const resolvedModel =
    model === "gemini-3.1-pro-preview" || model === "gemini-3.1-flash-lite-preview"
      ? model
      : "gemini-3-flash-preview";

  return await withRetry<DomainBlueprint>(
    async () => {
      const response = await ai.models.generateContent({
        model: resolvedModel,
        contents: instruction,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: blueprintSchema,
          maxOutputTokens: 16384,
        },
      });
      const rawText = extractResponseText(response);
      if (!rawText) {
        throw new TransientModelOutputError("Model returned an empty blueprint response.");
      }
      const parsed = parseModelJson<any>(rawText);
      if (!parsed || typeof parsed !== "object" || !parsed.title) {
        throw new TransientModelOutputError("Model returned malformed blueprint JSON.");
      }
      return {
        domain,
        title: String(parsed.title || ""),
        executiveSummary: String(parsed.executiveSummary || ""),
        architecturePhases: Array.isArray(parsed.architecturePhases) ? parsed.architecturePhases : [],
        tiersOrTokenomics: Array.isArray(parsed.tiersOrTokenomics) ? parsed.tiersOrTokenomics : [],
        gateCriteria: Array.isArray(parsed.gateCriteria) ? parsed.gateCriteria : [],
        escrowAndReceiptFlow: Array.isArray(parsed.escrowAndReceiptFlow) ? parsed.escrowAndReceiptFlow : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
      };
    },
    3,
    1500,
    onStatusUpdate,
    `${domain === "game-portal" ? "Game Portal" : "Crypto & Solana"} Blueprint (${resolvedModel})`
  );
};

