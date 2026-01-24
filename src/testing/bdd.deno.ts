export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  it as test,
} from "@std/testing/bdd";

type TestFn = () => void | Promise<void>;

export interface TestOptions {
  sanitizeResources?: boolean;
  sanitizeOps?: boolean;
  sanitizeExit?: boolean;
  skip?: boolean;
  only?: boolean;
  ignore?: boolean;
  timeout?: number;
}

export interface BddTestContext {
  name: string;
  origin?: string;
  parent?: BddTestContext;
  step?: (name: string, fn: TestFn) => Promise<void>;
}
