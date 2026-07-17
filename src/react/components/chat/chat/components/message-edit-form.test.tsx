import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { MessageEditForm } from "./message-edit-form.tsx";

describe("MessageEditForm", () => {
  it("renders the initial content inside the textarea", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Original message body"
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    assertStringIncludes(html, "Original message body");
    assertStringIncludes(html, "<textarea");
  });

  it("renders the default Save & Submit / Cancel labels", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Hello"
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    assertStringIncludes(html, "Save &amp; Submit");
    assertStringIncludes(html, "Cancel");
  });

  it("renders custom save/cancel labels when provided", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Hello"
        onSave={() => undefined}
        onCancel={() => undefined}
        saveLabel="Update"
        cancelLabel="Discard"
      />,
    );
    assertStringIncludes(html, "Update");
    assertStringIncludes(html, "Discard");
  });

  it("disables the save button when the initial content is blank", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="   "
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const saveButtonStart = html.indexOf("Save &amp; Submit");
    const buttonOpenTag = html.lastIndexOf("<button", saveButtonStart);
    assert(
      html.slice(buttonOpenTag, saveButtonStart).includes("disabled"),
      "expected the save button to be disabled for blank content",
    );
  });

  it("merges className and spreads extra props onto the wrapper", () => {
    const html = renderToString(
      <MessageEditForm
        initialContent="Hello"
        onSave={() => undefined}
        onCancel={() => undefined}
        className="vf-custom-edit-form"
        data-testid="edit-form"
      />,
    );
    assertStringIncludes(html, "vf-custom-edit-form");
    assertStringIncludes(html, 'data-testid="edit-form"');
  });
});
