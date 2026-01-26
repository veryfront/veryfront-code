import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_HEADER_SIZE_BYTES,
  DEFAULT_MAX_URL_LENGTH_BYTES,
} from "../../utils/constants/index.js";

export interface RequestLimits {
  maxBodySize?: number;
  maxUrlLength?: number;
  maxHeaderSize?: number;
  maxFileSize?: number;
}

export const DEFAULT_LIMITS: Required<RequestLimits> = {
  maxBodySize: DEFAULT_MAX_BODY_SIZE_BYTES,
  maxUrlLength: DEFAULT_MAX_URL_LENGTH_BYTES,
  maxHeaderSize: DEFAULT_MAX_HEADER_SIZE_BYTES,
  maxFileSize: DEFAULT_MAX_FILE_SIZE_BYTES,
};

export interface ParseJsonOptions {
  limits?: RequestLimits;
  sanitize?: boolean;
}

export interface ParseFormOptions {
  limits?: RequestLimits;
}

export interface ValidatedData<TBody = unknown, TQuery = unknown> {
  body?: TBody;
  query?: TQuery;
}
