import type { OwnershipResult } from '../types';

export type EligibilityState = 'valid'|'candidate'|'invalid';
export type CompletionState = 'none'|'acting'|'partial'|'complete'|'broken'|'counterproductive';
export type TargetResolutionState = 'untouched'|'acting'|'resolved'|'residual'|'escaped';
export type ResultIntegrityState = 'intact'|'impaired'|'broken'|'unknown';
export type AlignmentState = 'aligned'|'mixed'|'conflicting'|'unknown';
export type EfficiencyClass = 'matched'|'underutilized'|'overloaded'|'unknown';
export type StructureLevel = 'L0'|'L1'|'L2'|'L3'|'L4'|'L5';
export type ExecutionMode =
  | 'direct_control'
  | 'special_control'
  | 'clash_control'
  | 'penetration_assisted_control'
  | 'direct_combine'
  | 'serial_transform'
  | 'generation_output'
  | 'storage_capture'
  | 'formation_control'
  | 'composite'
  | 'unknown';

export interface TargetGraph {
  primaryTargets:string[];
  origins:string[];
  storages:string[];
  carriers:string[];
  bridges:string[];
  dependentTargets:string[];
}

export interface TargetResolution {
  targetId:string;
  state:TargetResolutionState;
  mechanisms:string[];
  relationIds:string[];
  evidence:string[];
  counterEvidence:string[];
}

export interface EfficiencyResult {
  class:EfficiencyClass;
  grade?:'high'|'medium'|'low'|'unknown';
  confidence?:'high'|'medium'|'low';
  basis?:'source_hint'|'book_structural'|'insufficient';
  executorUtilization:'low'|'normal'|'high'|'unknown';
  targetSupply:'undersupplied'|'matched'|'overloaded'|'unknown';
  wastedCapacity:'low'|'medium'|'high'|'unknown';
  evidence:string[];
}

export interface MagnitudeContribution {
  resultSignature:string;
  resultType:string;
  targetIds:string[];
  resultNodeIds:string[];
  sourcePathIds:string[];
  sourceRelationIds:string[];
  independent:boolean;
  completion:'partial'|'complete'|'unknown';
}

export interface MagnitudeResult {
  contributionCount:number;
  band:'none'|'small'|'medium'|'large'|'very_large';
  contributions:MagnitudeContribution[];
  note:string;
}

export interface DependencyEdge {
  fromPathId:string;
  toPathId:string;
  type:'requires'|'supports'|'coexists'|'shares_result';
  viaNodeIds:string[];
  evidence:string[];
}

export interface EdgeFunctionalState {
  relationId:string;
  semanticGate:'passed'|'conditional'|'failed'|'unknown';
  status:'active'|'constrained'|'blocked'|'unknown';
  role:'control'|'bridge'|'support'|'result'|'context';
  evidence:string[];
}

export interface OperationalIntentState {
  action:'obtain'|'control'|'retain'|'remove'|'transform'|'output'|'protect'|'be_controlled'|'unknown';
  confidence:'high'|'medium'|'low';
  evidence:string[];
}

export interface GongSettlement {
  pathId:string;
  eligibility:EligibilityState;
  executionMode:ExecutionMode;
  structureLevel:StructureLevel;
  targetGraph:TargetGraph;
  edgeFunctionalStates:EdgeFunctionalState[];
  operationalIntent:OperationalIntentState;
  targetResolutions:TargetResolution[];
  completion:CompletionState;
  residualTargetIds:string[];
  resultIntegrity:ResultIntegrityState;
  efficiency:EfficiencyResult;
  magnitude:MagnitudeResult;
  alignment:AlignmentState;
  alignmentEvidence:string[];
  semanticGate:{passed:string[];conditional:string[];failed:string[]};
  controlEvidenceRelationIds:string[];
  evidence:string[];
  counterEvidence:string[];
}

export interface MainlineVector {
  eligibility:number;
  bookEntry:number;
  completion:number;
  hostRelevance:number;
  confirmedGlobalWork:number;
  globalWork:number;
  unifiedRange:number;
  scope:number;
  controlRange:number;
  closure:number;
  alignment:number;
  integrity:number;
  ownership:number;
  magnitude:number;
  residual:number;
  efficiency:number;
  coverage:number;
  verifiedUnifiedWork:number;
  sourceTechnique:number;
  structuralGlobalWork:number;
  structure:number;
}

export interface MainlineV2Result<T=any> {
  primary:T|null;
  secondary:T|null;
  co_primary:boolean;
  co_primary_ids:string[];
  reason:string;
  arbitration:{
    mode:'lexicographic-v2';
    vector_order:string[];
    primary_vector:MainlineVector|null;
    audit:Array<{pathId:string;vector:MainlineVector;eligible:boolean}>;
  };
}

export interface SettlementContext {
  facts:any;
  relations:any[];
  semantics:any[];
  roots:any[];
  guestHost:any;
  intents:any[];
  qishi:any;
  chartZhengFan:any;
  origins:any[];
  ownership?:OwnershipResult;
}
