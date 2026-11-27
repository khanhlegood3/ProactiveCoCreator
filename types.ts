/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AppMode = 'image' | 'story' | 'video' | 'game-portal' | 'crypto-solana';

export type GamePortalTrack = 'playtest-b2b' | 'distribution-liveops' | 'gate-pricing';
export type CryptoSolanaTrack = 'pumpfun-launch' | 'solana-escrow' | 'usdt-usdc-rails';

export interface Candidate {
  name: string;
}

export interface Attribute {
  name: string;
  presence_in_prompt: boolean;
  value: Candidate[];
}

export interface Entity {
  name: string;
  presence_in_prompt: boolean;
  description: string;
  alternatives: Candidate[] | null;
  attributes: Attribute[];
}

export interface Relationship {
  source: string;
  target: string;
  label: string;
  alternatives?: Candidate[];
  presence_in_prompt?: boolean;
}

export interface BeliefState {
  entities: Entity[];
  relationships: Relationship[];
  prompt?: string;
}

export interface Clarification {
  question: string;
  options: string[];
}

export interface ImagePart {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export interface GeneratedImage {
  url: string | null;
  error?: string;
}

export interface BlueprintTierItem {
  name: string;
  targetAudience: string;
  priceOrFee: string;
  deliverables: string;
  settlementRail: string;
}

export interface BlueprintGateMetric {
  metric: string;
  threshold: string;
  sourceBenchmark: string;
  actionOnFail: string;
}

export interface BlueprintRiskItem {
  risk: string;
  evidence: string;
  mitigation: string;
}

export interface DomainBlueprint {
  domain: 'game-portal' | 'crypto-solana';
  title: string;
  executiveSummary: string;
  architecturePhases: {
    phase: string;
    objective: string;
    stack: string;
    revenueModel: string;
  }[];
  tiersOrTokenomics: BlueprintTierItem[];
  gateCriteria: BlueprintGateMetric[];
  escrowAndReceiptFlow: string[];
  risks: BlueprintRiskItem[];
  nextActions: string[];
}

export type ImageSize = '512px' | '1K' | '2K' | '4K';
export type VideoResolution = '720p' | '1080p';
export type StoryType = 'generic' | 'video-prompt';
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '1:4' | '1:8' | '4:1' | '8:1';
export type Proactiveness = 'low' | 'medium' | 'high';

export type Language = 'vi' | 'en';

export type GraphUpdate =
  | { type: 'attribute'; entity: string; attribute: string; value: string }
  | { type: 'relationship'; source: string; target: string; oldLabel: string; newLabel: string };

export interface WorkspaceSnapshot {
  id: 'current';
  updatedAt: string;
  language?: Language;
  mode: AppMode;
  gamePortalTrack: GamePortalTrack;
  cryptoSolanaTrack: CryptoSolanaTrack;
  prompt: string;
  uploadedImages: ImagePart[];
  aspectRatio: AspectRatio;
  resolution: string;
  selectedModel: string;
  selectedClarificationModel: string;
  storyType: StoryType;
  proactiveness: Proactiveness;
  beliefGraph: BeliefState | null;
  clarifications: Clarification[];
  answeredQuestions: string[];
  skippedQuestions: string[];
  pendingAttributeUpdates: Record<string, string>;
  pendingRelationshipUpdates: Record<string, string>;
  pendingClarificationAnswers: Record<string, string>;
  lastAnalyzedPrompt: string | null;
  lastAnalyzedMode: AppMode | null;
  lastAnalyzedImagesSignature: string;
  hasGenerated: boolean;
  isOutdated: boolean;
  activeToolTab: 'clarify' | 'graph' | 'attributes';
  isDarkMode: boolean;
  images: GeneratedImage[];
  story: string | null;
  video: string | null;
  blueprints: Partial<Record<'game-portal' | 'crypto-solana', DomainBlueprint | null>>;
  galleryErrors: Record<AppMode, string | null>;
}

export interface SavedSessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  actionType: 'analyze' | 'refine' | 'generate' | 'snapshot' | 'imported';
  mode: AppMode;
  domainTrack?: GamePortalTrack | CryptoSolanaTrack;
  prompt: string;
  refinedFromPrompt?: string;
  qaPairs?: { question: string; answer: string }[];
  graphUpdatesApplied?: GraphUpdate[];
  clarifications: Clarification[];
  answeredQuestions: string[];
  skippedQuestions: string[];
  pendingClarificationAnswers: Record<string, string>;
  beliefGraph: BeliefState | null;
  pendingAttributeUpdates: Record<string, string>;
  pendingRelationshipUpdates: Record<string, string>;
  settings: {
    aspectRatio: AspectRatio;
    resolution: string;
    selectedModel: string;
    selectedClarificationModel: string;
    storyType: StoryType;
    proactiveness: Proactiveness;
    uploadedImages: ImagePart[];
  };
  results: {
    images: GeneratedImage[];
    story: string | null;
    video: string | null;
    blueprint: DomainBlueprint | null;
    error: string | null;
  };
}

export interface CoCreatorExportBundle {
  schemaVersion: number;
  app: 'proactive-co-creator';
  exportedAt: string;
  currentWorkspace: WorkspaceSnapshot;
  sessions: SavedSessionRecord[];
}

