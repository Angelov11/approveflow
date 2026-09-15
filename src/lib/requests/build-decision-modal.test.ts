import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVE_DECISION_CALLBACK_ID,
  buildDecisionModal,
  MAX_DECISION_COMMENT_LENGTH,
  REJECT_DECISION_CALLBACK_ID,
  type BuildDecisionModalParams,
} from "./build-decision-modal.ts";

interface PlainModalView {
  callback_id: string;
  private_metadata: string;
  title: { text: string };
  submit: { text: string };
  close: { text: string };
  blocks: { block_id: string; optional?: boolean; label: { text: string }; element: { max_length: number } }[];
}

function build(params: BuildDecisionModalParams): PlainModalView {
  return buildDecisionModal(params) as unknown as PlainModalView;
}

const messageSource = { type: "message" as const, channelId: "C123", messageTs: "1234.5678" };
const modalSource = { type: "modal" as const, viewId: "V123" };

test("Approve modal: correct title, submit label, callback id, and an OPTIONAL Comment field", () => {
  const view = build({ decision: "APPROVED", requestId: "req-1", source: messageSource });
  assert.equal(view.callback_id, APPROVE_DECISION_CALLBACK_ID);
  assert.equal(view.title.text, "Approve Request");
  assert.equal(view.submit.text, "Approve");
  const block = view.blocks[0];
  assert.equal(block.optional, true);
  assert.equal(block.label.text, "Comment");
});

test("Reject modal: correct title, submit label, callback id, and a REQUIRED Reason field", () => {
  const view = build({ decision: "REJECTED", requestId: "req-1", source: messageSource });
  assert.equal(view.callback_id, REJECT_DECISION_CALLBACK_ID);
  assert.equal(view.title.text, "Reject Request");
  assert.equal(view.submit.text, "Reject");
  const block = view.blocks[0];
  assert.equal(block.optional, false);
  assert.equal(block.label.text, "Reason");
});

test("max length is configured on the input element", () => {
  const view = build({ decision: "APPROVED", requestId: "req-1", source: messageSource });
  assert.equal(view.blocks[0].element.max_length, MAX_DECISION_COMMENT_LENGTH);
});

test("private_metadata carries only the request locator and reflection source — nothing else", () => {
  const view = build({ decision: "APPROVED", requestId: "req-42", source: modalSource });
  const metadata = JSON.parse(view.private_metadata);
  assert.deepEqual(metadata, { requestId: "req-42", source: { type: "modal", viewId: "V123" } });
});

test("message-origin private_metadata never carries the original message blocks (private_metadata size safety)", () => {
  const view = build({ decision: "REJECTED", requestId: "req-1", source: messageSource });
  const metadata = JSON.parse(view.private_metadata);
  assert.deepEqual(metadata.source, { type: "message", channelId: "C123", messageTs: "1234.5678" });
  assert.ok(!("messageBlocks" in metadata.source));
});

test("Cancel is the close button on both modals", () => {
  const approve = build({ decision: "APPROVED", requestId: "req-1", source: messageSource });
  const reject = build({ decision: "REJECTED", requestId: "req-1", source: messageSource });
  assert.equal(approve.close.text, "Cancel");
  assert.equal(reject.close.text, "Cancel");
});
