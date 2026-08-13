const {
  catalog,
  templateCatalog,
} = require("../src/services/garment-catalog.service");
const { transitions } = require("../src/utils/order-status");

describe("garment catalogue", () => {
  test("contains unique practical templates across every audience", () => {
    const names = Object.values(catalog).flat();
    expect(names).toHaveLength(31);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(catalog)).toEqual(["men", "women", "kids", "unisex"]);
  });

  test("every template has distinct garment-specific measurements", () => {
    for (const templates of Object.values(templateCatalog)) {
      for (const template of templates) {
        expect(template.fields.length).toBeGreaterThanOrEqual(4);
        expect(new Set(template.fields).size).toBe(template.fields.length);
        expect(template.fields.every((field) => field.trim().length > 1)).toBe(
          true,
        );
      }
    }
  });

  test("confirmed orders move directly to cutting", () => {
    expect(transitions.pending).toEqual(["cutting", "cancelled"]);
  });
});
