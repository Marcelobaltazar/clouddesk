import { describe, expect, it } from "vitest";
import { indexState, type IndexStatusFields } from "./kb-index";

const base: IndexStatusFields = {
  content_hash: "abc",
  indexed_hash: null,
  index_chunks: null,
  index_error: null,
  indexed_at: null,
};

describe("indexState", () => {
  it("nunca indexado", () => {
    expect(indexState(base)).toBe("missing");
  });

  it("indexado quando o hash do índice é o do texto atual", () => {
    expect(indexState({ ...base, indexed_hash: "abc", index_chunks: 3 })).toBe("indexed");
  });

  it("desatualizado quando o texto mudou depois da indexação", () => {
    expect(indexState({ ...base, content_hash: "novo", indexed_hash: "abc" })).toBe("stale");
  });

  it("erro na última tentativa aparece mesmo com índice antigo", () => {
    expect(indexState({ ...base, content_hash: "novo", indexed_hash: "abc", index_error: "HTTP 546" })).toBe("error");
  });

  it("erro antigo não esconde um índice em dia", () => {
    expect(indexState({ ...base, indexed_hash: "abc", index_error: "falhou antes" })).toBe("indexed");
  });
});
