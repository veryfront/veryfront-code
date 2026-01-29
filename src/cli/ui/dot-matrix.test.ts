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

describe("cli/ui/dot-matrix", () => {
  describe("AGENT_FACE", () => {
    it("should be a 7x7 grid", () => {
      assertEquals(AGENT_FACE.length, 7);
      for (const row of AGENT_FACE) {
        assertEquals(row.length, 7);
      }
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
          AGENT_FACE[row]![col],
          1,
          `Position [${row},${col}] should be lit in AGENT_FACE`,
        );
      }
    });

    it("should contain tuples of [row, col]", () => {
      for (const pos of V_LOGO_POSITIONS) {
        assertEquals(pos.length, 2);
        assertEquals(pos[0]! >= 0 && pos[0]! < 7, true);
        assertEquals(pos[1]! >= 0 && pos[1]! < 7, true);
      }
    });
  });

  describe("renderDotMatrix", () => {
    it("should render a pattern as a multi-line string", () => {
      const result = renderDotMatrix(AGENT_FACE);
      const lines = result.split("\n");
      assertEquals(lines.length, 7);
    });

    it("should use custom lit and off characters", () => {
      const result = renderDotMatrix(
        [[1, 0], [0, 1]],
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
      const frame = generateSpinnerFrame(0);
      assertEquals(frame.length, 7);
      for (const row of frame) {
        assertEquals(row.length, 7);
      }
    });

    it("should have exactly tailLength lit dots", () => {
      const tailLength = 3;
      const frame = generateSpinnerFrame(0, tailLength);
      let litCount = 0;
      for (const row of frame) {
        for (const cell of row) {
          if (cell === 1) litCount++;
        }
      }
      assertEquals(litCount, tailLength);
    });

    it("should wrap around at the end of positions", () => {
      const frame = generateSpinnerFrame(V_LOGO_POSITIONS.length);
      // Should be same as frame 0
      const frame0 = generateSpinnerFrame(0);
      assertEquals(JSON.stringify(frame), JSON.stringify(frame0));
    });

    it("should use custom tail length", () => {
      const frame = generateSpinnerFrame(5, 5);
      let litCount = 0;
      for (const row of frame) {
        for (const cell of row) {
          if (cell === 1) litCount++;
        }
      }
      assertEquals(litCount, 5);
    });
  });

  describe("generateSpinnerFrames", () => {
    it("should return frames equal to number of positions", () => {
      const frames = generateSpinnerFrames();
      assertEquals(frames.length, V_LOGO_POSITIONS.length);
    });

    it("should return valid 7x7 grids for each frame", () => {
      const frames = generateSpinnerFrames();
      for (const frame of frames) {
        assertEquals(frame.length, 7);
        for (const row of frame) {
          assertEquals(row.length, 7);
        }
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
      const result = agentSays("Testing!");
      assertEquals(result.includes("Testing!"), true);
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
      const anim = new AnimatedDotMatrix();
      assertEquals(anim.spinning, false);
    });

    it("should render the face", () => {
      const anim = new AnimatedDotMatrix();
      const result = anim.render();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should render with text", () => {
      const anim = new AnimatedDotMatrix();
      const result = anim.renderWithText(["Test"]);
      assertEquals(result.includes("Test"), true);
    });

    it("should return height of 7", () => {
      const anim = new AnimatedDotMatrix();
      assertEquals(anim.getHeight(), 7);
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
      const custom = [[0, 1], [1, 0]];
      anim.setPattern(custom);
      // Should render without error
      const result = anim.render();
      assertEquals(typeof result, "string");
    });
  });
});
