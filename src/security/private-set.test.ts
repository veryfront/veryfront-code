import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPrivateSet } from "./private-set.ts";

describe("private selector sets", () => {
  it("snapshots caller-owned arrays and sets without sharing later membership changes", () => {
    const source = ["read_file", "read_file"];
    const first = createPrivateSet(source);
    source.push("update_file");
    const second = createPrivateSet(first);
    first.add("invoke_agent");
    assertEquals([...second], ["read_file"]);
    assertEquals(second.has("update_file"), false);
    assertEquals(second.has("invoke_agent"), false);
    assertEquals(second.size, 1);
  });

  it("keeps captured membership and iteration bound to their owning set", () => {
    const names = createPrivateSet(["read_file"]);
    const { add, has, delete: remove, values } = names;
    assertEquals(has("read_file"), true);
    add("update_file");
    assertEquals([...values()], ["read_file", "update_file"]);
    assertEquals(remove("read_file"), true);
    assertEquals(has("read_file"), false);
    assertEquals(names.size, 1);
  });
});
