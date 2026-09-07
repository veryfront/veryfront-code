const ObjectCreate = Object.create;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const NativeTypeError = TypeError;
const ResponseInitFields = ["headers", "status", "statusText"] as const;

interface ResponseInitPrototype {
  headers?: unknown;
  status?: unknown;
  statusText?: unknown;
}

/** Build explicit response options after inspecting the native dictionary's prototype. */
export function buildResponseInit(
  objectPrototype: ResponseInitPrototype,
  status?: number,
  statusText?: string,
): ResponseInit {
  // Node assigns into a normal internal dictionary, so inherited accessors
  // can intercept even explicit fields. Reject that state without invoking
  // project code or changing process-wide prototypes during construction.
  for (let index = 0; index < ResponseInitFields.length; index++) {
    const field = ResponseInitFields[index]!;
    const descriptor = ObjectGetOwnPropertyDescriptor(objectPrototype, field);
    if (descriptor && !ObjectHasOwn(descriptor, "value")) {
      throw new NativeTypeError("Cannot construct a response with inherited option accessors");
    }
  }
  // Supply every field so Node's internal dictionary cannot inherit defaults.
  const init: ResponseInit = ObjectCreate(null);
  init.headers = ObjectCreate(null);
  init.status = status === undefined ? 200 : status;
  init.statusText = statusText === undefined ? "" : statusText;
  return init;
}
