type Schema = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  maxItems?: number;
  minItems?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

export function problems(value: unknown, schema: Schema, at = ""): string[] {
  if (schema.enum && !schema.enum.includes(value)) return [`${at} is not one of ${schema.enum.join(", ")}`];
  if (schema.type === "string") {
    if (typeof value !== "string") return [`${at} is not a string`];
    return schema.maxLength !== undefined && value.length > schema.maxLength ? [`${at} is longer than ${schema.maxLength}`] : [];
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${at} is not a number`];
    if (schema.minimum !== undefined && value < schema.minimum) return [`${at} is below ${schema.minimum}`];
    return schema.maximum !== undefined && value > schema.maximum ? [`${at} is above ${schema.maximum}`] : [];
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${at} is not an array`];
    const found: string[] = [];
    if (schema.maxItems !== undefined && value.length > schema.maxItems) found.push(`${at} has more than ${schema.maxItems} items`);
    if (schema.minItems !== undefined && value.length < schema.minItems) found.push(`${at} has fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((item, index) => found.push(...problems(item, schema.items as Schema, `${at}[${index}]`)));
    return found;
  }
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${at} is not an object`];
    const found: string[] = [];
    for (const key of schema.required ?? []) if (!(key in value)) found.push(`${at}.${key} is missing`);
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) found.push(...problems(item, property, `${at}.${key}`));
      else if (schema.additionalProperties === false) found.push(`${at}.${key} is not allowed`);
    }
    return found;
  }
  return [];
}
