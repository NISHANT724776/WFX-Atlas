/** How a field gets its value inside a WFX transaction. */
export type FieldKind = 'key' | 'entered' | 'linked' | 'calculated';

export interface FieldDef {
  name: string;
  kind: FieldKind;
  /** Plain-language meaning of the field. */
  definition: string;
  /** For linked fields: slug of the transaction the value is pulled from. */
  from?: string;
  /** For linked fields: the field on the source transaction. */
  fromField?: string;
  /** For calculated fields: id of the calculation that produces it. */
  calc?: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldDef[];
}

/** verified = proved against a WFX screen value; assumed = inferred, waiting for confirmation. */
export type CalcStatus = 'verified' | 'assumed';

export interface Calculation {
  id: string;
  txn: string;
  name: string;
  formula: string;
  explanation: string;
  /** Worked example using the Flannel Shirt Adi (NIS-58) data. */
  example: string;
  status: CalcStatus;
  /** Open question for the functional owner when status is "assumed". */
  question?: string;
}

export interface Check {
  label: string;
  workbook: string | number;
  wfx: string | number;
  match: boolean;
  note?: string;
}

export interface DataTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  note?: string;
  /** Index of a column whose cells hold a colour code and should link to the colour tracker. */
  colorCol?: number;
}

export interface CaseNote {
  title: string;
  body: string;
  kind: 'rule' | 'observation' | 'mismatch';
}

export interface Link {
  slug: string;
  what: string;
}

export interface Transaction {
  slug: string;
  step: number;
  name: string;
  module: string;
  screen: string;
  description: string;
  theory: string[];
  keys: { name: string; format: string; example: string }[];
  upstream: Link[];
  downstream: Link[];
  fieldGroups: FieldGroup[];
  calcs: string[];
  checks: Check[];
  tables: DataTable[];
  cases: CaseNote[];
}
