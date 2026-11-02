// Shared types for the scan stream, the raw in-page extraction and the final BrandGuide.

/* ------------------------------------------------------------------ */
/* Stream events                                                       */
/* ------------------------------------------------------------------ */

export type StepStatus = "running" | "done" | "warn";

export type StepId =
  | "validate"
  | "browser"
  | "navigate"
  | "cookies"
  | "scroll"
  | "extract"
  | "colors"
  | "typography"
  | "logo"
  | "ui"
  | "voice"
  | "finalize";

export type ErrorCode =
  | "invalid_url"
  | "blocked_url"
  | "bot_protected"
  | "timeout"
  | "nav_failed"
  | "internal";

export interface StartEvent {
  type: "start";
  url: string;
}

export interface StepEvent {
  type: "step";
  id: StepId;
  status: StepStatus;
  title: string;
  detail?: string;
}

export interface ShotEvent {
  type: "shot";
  label: string;
  /** base64-encoded JPEG, without the data: prefix */
  data: string;
}

export type PartialKey = "logo" | "colors" | "typography" | "ui" | "imagery" | "voice";

export type PartialEvent = {
  [K in PartialKey]: { type: "partial"; key: K; value: BrandGuide[K] };
}[PartialKey];

export interface DoneEvent {
  type: "done";
  brand: BrandGuide;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  code: ErrorCode;
}

export type ScanEvent = StartEvent | StepEvent | ShotEvent | PartialEvent | DoneEvent | ErrorEvent;

/* ------------------------------------------------------------------ */
/* Raw extraction (what extractor.js returns from inside the page)      */
/* ------------------------------------------------------------------ */

/** colour string (as computed by the browser, e.g. "rgb(1, 2, 3)") → accumulated weight */
export type WeightMap = Record<string, number>;

export interface RawButton {
  text: string;
  bg: string;
  color: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: string;
  paddingX: number;
  paddingY: number;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  textTransform: string;
  letterSpacing: string;
  boxShadow: string;
  height: number;
  width: number;
  top: number;
  inHeader: boolean;
  score: number;
}

export interface RawLink {
  color: string;
  textDecoration: string;
  fontWeight: string;
  count: number;
}

export interface RawTypeSample {
  tag: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  fontFamily: string;
  color: string;
  text: string;
  count: number;
}

export interface RawFontFace {
  family: string;
  weight: string;
  style: string;
}

export interface RawLogoCandidate {
  kind: "svg" | "img";
  /** serialised SVG markup (for kind=svg) */
  svg?: string;
  /** absolute URL (for kind=img) */
  src?: string;
  alt: string;
  width: number;
  height: number;
  score: number;
  reasons: string[];
}

export interface RawIcon {
  rel: string;
  href: string;
  sizes?: string;
}

export interface RawImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface RawExtraction {
  title: string;
  siteName: string;
  description: string;
  lang: string;
  bgColors: WeightMap;
  textColors: WeightMap;
  borderColors: WeightMap;
  cssVars: Record<string, string>;
  buttons: RawButton[];
  links: RawLink[];
  fontFaces: RawFontFace[];
  /** family stack → weighted text length */
  families: Record<string, number>;
  headingFamilies: Record<string, number>;
  typeSamples: RawTypeSample[];
  radii: Record<string, number>;
  spacing: Record<string, number>;
  shadows: Record<string, number>;
  logos: RawLogoCandidate[];
  icons: RawIcon[];
  manifestUrl?: string;
  ogImage?: string;
  images: RawImage[];
  h1: string[];
  headings: string[];
  ctaLabels: string[];
  paragraphs: string[];
  textElementCount: number;
}

export interface SampleResult {
  colors: WeightMap;
  points: number;
}

/* ------------------------------------------------------------------ */
/* Final brand guide                                                   */
/* ------------------------------------------------------------------ */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export type ColorSource = "background" | "text" | "border" | "cta" | "variable";

export interface ColorCluster {
  hex: string;
  oklch: Oklch;
  weight: number;
  /** 0..1 share of total weight */
  share: number;
  chromatic: boolean;
  sources: Partial<Record<ColorSource, number>>;
  members: string[];
}

export type ContrastRating = "AAA" | "AA" | "AA Large" | "Fail";

export interface ContrastResult {
  ratio: number;
  rating: ContrastRating;
}

export type ColorRoleName =
  | "primary"
  | "secondary"
  | "accent"
  | "background"
  | "surface"
  | "text"
  | "muted"
  | "border";

export interface ColorRole {
  role: ColorRoleName;
  hex: string;
  oklch: Oklch;
  /** why this colour got this role, for the thinking log / tooltip */
  reason: string;
  derived: boolean;
  onWhite: ContrastResult;
  onBlack: ContrastResult;
  /** best text colour to put on top of this colour */
  onColor: string;
}

export interface ContrastPair {
  label: string;
  fgHex: string;
  bgHex: string;
  result: ContrastResult;
}

export interface ColorPalette {
  roles: ColorRole[];
  all: ColorCluster[];
  pairs: ContrastPair[];
  samplePoints: number;
}

export interface FontSource {
  url: string;
  weight: string;
  style: string;
  format: string;
}

export interface FontFamilyInfo {
  family: string;
  stack: string;
  role: "heading" | "body" | "heading & body" | "other";
  weights: string[];
  /** share of visible text rendered in this family (0..1) */
  usage: number;
  sources: FontSource[];
  isSystem: boolean;
}

export interface TypeScaleEntry {
  tag: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  family: string;
  sample: string;
}

export interface Typography {
  families: FontFamilyInfo[];
  headingFamily: string;
  bodyFamily: string;
  scale: TypeScaleEntry[];
  /** approximate modular-scale ratio between steps, or null */
  ratio: number | null;
  baseSize: number;
}

export interface ButtonStyle {
  label: string;
  background: string;
  color: string;
  border: string;
  borderRadius: string;
  padding: string;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  textTransform: string;
  letterSpacing: string;
  boxShadow: string;
}

export interface LinkStyle {
  color: string;
  textDecoration: string;
  fontWeight: string;
}

export interface Token {
  value: string;
  count: number;
}

export interface UiElements {
  primaryButton: ButtonStyle | null;
  secondaryButton: ButtonStyle | null;
  link: LinkStyle | null;
  radius: Token[];
  spacing: Token[];
  shadows: Token[];
}

export interface LogoAsset {
  kind: "svg" | "img" | "png";
  /** data: URL or absolute remote URL */
  src: string;
  /** raw SVG markup, when kind=svg */
  svg?: string;
  alt: string;
  width: number;
  height: number;
  score: number;
  reasons: string[];
}

export interface IconAsset {
  rel: string;
  href: string;
  sizes?: string;
}

export interface LogoSet {
  primary: LogoAsset | null;
  alternates: LogoAsset[];
  icons: IconAsset[];
}

export interface ImageAsset {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface VoiceStats {
  avgHeadlineWords: number;
  caseStyle: "sentence" | "title" | "upper" | "mixed";
  exclamationRate: number;
  youRate: number;
}

export interface Voice {
  title: string;
  description: string;
  headline: string;
  headings: string[];
  ctas: string[];
  keywords: string[];
  traits: string[];
  stats: VoiceStats;
}

export interface BrandGuide {
  url: string;
  finalUrl: string;
  domain: string;
  name: string;
  scannedAt: string;
  durationMs: number;
  logo: LogoSet;
  colors: ColorPalette;
  typography: Typography;
  ui: UiElements;
  imagery: ImageAsset[];
  voice: Voice;
}
