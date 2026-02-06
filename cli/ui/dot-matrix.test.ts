import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AGENT_FACE,
  agentSays,
  AnimatedDotMatrix,
  generateSpinnerFrame,
  generateSpinnerFrames,
  getAgentFace,
  getAgentFaceWithText,
  getInlineFace,
  renderDotMatrix,
  V_LOGO_POSITIONS,
} from "./dot-matrix.ts";

function countLitDots(grid: number[][]): number {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell === 1) count++;
    }
  }
  return count;
}

function assertIs7x7Grid(grid: number[][]): void {
  assertEquals(grid.length, 7);
  for (const row of grid) {
    assertEquals(row.length, 7);
  }
}

describe("cli/ui/dot-matrix", () => {
  describe("AGENT_FACE", () => {
    it("should be a 7x7 grid", () => {
      assertIs7x7Grid(AGENT_FACE);
    });

    it("should only contain 0s and 1s", () => {
      for (const row of AGENT_FACE) {
        for (const cell of row) {
          assertEquals(cell === 0 || cell === 1, true);
        }
      }
    });
  });

  describe("V_LOGO_POSITIONS", () => {
    it("should have 16 positions", () => {
      assertEquals(V_LOGO_POSITIONS.length, 16);
    });

    it("should have positions that match lit dots in AGENT_FACE", () => {
      for (const [row, col] of V_LOGO_POSITIONS) {
        assertEquals(
          AGENT_FACE[row]?.[col],
          1,
          `Position [${row},${col}] should be lit in AGENT_FACE`,
        );
      }
    });

    it("should contain tuples of [row, col]", () => {
      for (const [row, col] of V_LOGO_POSITIONS) {
        assertEquals([row, col].length, 2);
        assertEquals(row >= 0 && row < 7, true);
        assertEquals(col >= 0 && col < 7, true);
      }
    });
  });

  describe("renderDotMatrix", () => {
    it("should render a pattern as a multi-line string", () => {
      const result = renderDotMatrix(AGENT_FACE);
      assertEquals(result.split("\n").length, 7);
    });

    it("should use custom lit and off characters", () => {
      const result = renderDotMatrix(
        [
          [1, 0],
          [0, 1],
        ],
        { litChar: "X", offChar: ".", litColor: "", offColor: "" },
      );
      assertEquals(result.includes("X"), true);
      assertEquals(result.includes("."), true);
    });

    it("should apply compact mode", () => {
      const result = renderDotMatrix(AGENT_FACE, { compact: true });
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });
  });

  describe("generateSpinnerFrame", () => {
    it("should return a 7x7 grid", () => {
      assertIs7x7Grid(generateSpinnerFrame(0));
    });

    it("should have exactly tailLength lit dots", () => {
      const tailLength = 3;
      const frame = generateSpinnerFrame(0, tailLength);
      assertEquals(countLitDots(frame), tailLength);
    });

    it("should wrap around at the end of positions", () => {
      const frame = generateSpinnerFrame(V_LOGO_POSITIONS.length);
      const frame0 = generateSpinnerFrame(0);
      assertEquals(JSON.stringify(frame), JSON.stringify(frame0));
    });

    it("should use custom tail length", () => {
      const frame = generateSpinnerFrame(5, 5);
      assertEquals(countLitDots(frame), 5);
    });
  });

  describe("generateSpinnerFrames", () => {
    it("should return frames equal to number of positions", () => {
      assertEquals(generateSpinnerFrames().length, V_LOGO_POSITIONS.length);
    });

    it("should return valid 7x7 grids for each frame", () => {
      for (const frame of generateSpinnerFrames()) {
        assertIs7x7Grid(frame);
      }
    });
  });

  describe("getAgentFace", () => {
    it("should return a non-empty string", () => {
      const face = getAgentFace();
      assertEquals(typeof face, "string");
      assertEquals(face.length > 0, true);
    });
  });

  describe("getAgentFaceWithText", () => {
    it("should include text alongside the face", () => {
      const result = getAgentFaceWithText(["Hello", "World"]);
      assertEquals(result.includes("Hello"), true);
      assertEquals(result.includes("World"), true);
    });

    it("should handle empty text lines", () => {
      const result = getAgentFaceWithText([]);
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });
  });

  describe("agentSays", () => {
    it("should include the message", () => {
      assertEquals(agentSays("Testing!").includes("Testing!"), true);
    });
  });

  describe("getInlineFace", () => {
    it("should return a non-empty string", () => {
      const face = getInlineFace();
      assertEquals(typeof face, "string");
      assertEquals(face.length > 0, true);
    });
  });

  describe("AnimatedDotMatrix", () => {
    it("should create an instance", () => {
      assertEquals(new AnimatedDotMatrix().spinning, false);
    });

    it("should render the face", () => {
      const result = new AnimatedDotMatrix().render();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should render with text", () => {
      const result = new AnimatedDotMatrix().renderWithText(["Test"]);
      assertEquals(result.includes("Test"), true);
    });

    it("should return height of 7", () => {
      assertEquals(new AnimatedDotMatrix().getHeight(), 7);
    });

    it("should start and stop spinner", () => {
      const anim = new AnimatedDotMatrix();
      const frames: string[] = [];

      anim.startSpinner((frame) => frames.push(frame));
      assertEquals(anim.spinning, true);
      assertEquals(frames.length >= 1, true);

      anim.stop();
      assertEquals(anim.spinning, false);
    });

    it("should reset to face pattern", () => {
      const anim = new AnimatedDotMatrix();
      anim.setPattern([[1]]);
      anim.reset();
      assertEquals(anim.spinning, false);
    });

    it("should set custom pattern", () => {
      const anim = new AnimatedDotMatrix();
      anim.setPattern([
        [0, 1],
        [1, 0],
      ]);
      assertEquals(typeof anim.render(), "string");
    });
  });
});
