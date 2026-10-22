import type { CodeEdit } from '../codeEdits';

export interface GuideRange {
  symbolId?: string;
  line: number;
  startColumn: number;
  endColumn: number;
  symbol: string;
  role: 'source' | 'transform' | 'sink';
}
export interface GuideFlowNode {
  label: string;
  flowKey?: string;
  // Illustrative value at this point in this step; never evaluated as code.
  sampleValue?: string;
  reference?: GuideRange;
}
export interface GuideFlow {
  kind: 'current' | 'proposed';
  connections?: { from: number; to: number }[];
  nodes: GuideFlowNode[];
}
export interface GuideStep {
  description: string;
  links?: GuideRange[];
  flow?: GuideFlow;
}
export type GuideSeverity = 'critical' | 'warning' | 'info';
export type GuideCategory = 'bug' | 'style' | 'performance' | 'security';
export interface GuideFinding {
  id: string;
  summary: string;
  description: string;
  severity: GuideSeverity;
  category: GuideCategory;
  lineStart: number;
  lineEnd: number;
  steps: GuideStep[];
  fix: string;
  edit?: CodeEdit;
  detailStatus?: 'pending' | 'ready' | 'failed';
  detailError?: string;
  state?: 'current' | 'resolved' | 'needs-recheck';
}
