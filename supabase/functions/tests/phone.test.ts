import { assertEquals } from "jsr:@std/assert@1";
import { detectOperator, normalizeCmPhone } from "../_shared/phone.ts";

Deno.test("normalizeCmPhone accepts common formats", () => {
  assertEquals(normalizeCmPhone("677 12 34 56"), "237677123456");
  assertEquals(normalizeCmPhone("+237 677-123-456"), "237677123456");
  assertEquals(normalizeCmPhone("00237699999999"), "237699999999");
  assertEquals(normalizeCmPhone("237655000111"), "237655000111");
});

Deno.test("normalizeCmPhone rejects invalid numbers", () => {
  assertEquals(normalizeCmPhone("2 33 42 00 00"), null); // landline
  assertEquals(normalizeCmPhone("67712345"), null);      // too short
  assertEquals(normalizeCmPhone(""), null);
});

Deno.test("detectOperator", () => {
  assertEquals(detectOperator("237677123456"), "mtn");
  assertEquals(detectOperator("237652000000"), "mtn");
  assertEquals(detectOperator("237685000000"), "mtn");
  assertEquals(detectOperator("237699999999"), "orange");
  assertEquals(detectOperator("237657000000"), "orange");
  assertEquals(detectOperator("237620000000"), null);
});
