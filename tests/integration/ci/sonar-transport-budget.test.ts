import { assert } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("full-report socket waits cannot preempt the configured response budget", async () => {
  const text = await Deno.readTextFile(
    new URL("../../../sonar-project.properties", import.meta.url),
  );
  // SonarCloud documents a 60-second default for both limits.
  // https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui
  const seconds = (key: string) => {
    const entries = [...text.matchAll(/^([^#!\s][^=]*)=(.*)$/gm)].filter((entry) =>
      entry[1]?.trim() === key
    );
    const value = Number(entries.at(-1)?.[2] ?? 60);
    assert(
      Number.isSafeInteger(value) && value > 0 && value <= 300,
      `${key} must stay finite and bounded`,
    );
    return value;
  };
  const response = seconds("sonar.scanner.responseTimeout");
  const socket = seconds("sonar.scanner.socketTimeout");
  assert(
    response >= 120,
    "Full-report uploads need more than the documented default response budget",
  );
  assert(
    socket >= response,
    "A shorter default socket wait would cut off the full-report response budget",
  );
});
