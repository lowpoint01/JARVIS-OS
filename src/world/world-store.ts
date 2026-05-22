import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/id.js";

export const WORLD_ENTITY_TYPES = [
  "project",
  "device",
  "service",
  "file",
  "person",
  "custom",
] as const;

export type WorldEntityType = (typeof WORLD_ENTITY_TYPES)[number];

export type WorldEntity = {
  id: string;
  type: WorldEntityType;
  name: string;
  aliases: string[];
  summary: string;
  tags: string[];
  attributes: Record<string, unknown>;
  confidence: number;
  createdAt: number;
  updatedAt: number;
};

export type WorldRelation = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export type WorldState = {
  entities: WorldEntity[];
  relations: WorldRelation[];
};

export type UpsertWorldEntityInput = {
  id?: string;
  type?: WorldEntityType;
  name: string;
  aliases?: string[];
  summary?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  confidence?: number;
};

export type AddWorldRelationInput = {
  fromId: string;
  toId: string;
  type: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

function clamp01(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value as number));
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function asEntityType(value: WorldEntityType | undefined): WorldEntityType {
  return value && WORLD_ENTITY_TYPES.includes(value) ? value : "custom";
}

function publicEntity(entity: WorldEntity): WorldEntity {
  return {
    ...entity,
    aliases: entity.aliases.slice(),
    tags: entity.tags.slice(),
    attributes: { ...entity.attributes },
  };
}

function publicRelation(relation: WorldRelation): WorldRelation {
  return {
    ...relation,
    metadata: { ...relation.metadata },
  };
}

export class WorldStore {
  private state: WorldState = {
    entities: [],
    relations: [],
  };
  private initialized = false;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = raw.trim()
        ? (JSON.parse(raw) as WorldState)
        : {
            entities: [],
            relations: [],
          };
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        await this.persist();
      } else {
        throw err;
      }
    }
    this.initialized = true;
  }

  countEntities(): number {
    this.assertInitialized();
    return this.state.entities.length;
  }

  countRelations(): number {
    this.assertInitialized();
    return this.state.relations.length;
  }

  async upsertEntity(input: UpsertWorldEntityInput): Promise<WorldEntity> {
    this.assertInitialized();
    const name = normalizeText(input.name);
    if (!name) {
      throw new Error("World entity name cannot be empty.");
    }
    const type = asEntityType(input.type);
    const now = Date.now();
    const existing = input.id
      ? this.state.entities.find((entity) => entity.id === input.id)
      : this.state.entities.find(
          (entity) => entity.type === type && entity.name.toLowerCase() === name.toLowerCase(),
        );
    if (existing) {
      existing.name = name;
      existing.type = type;
      existing.aliases = Array.from(new Set([...(input.aliases ?? existing.aliases)].map(normalizeText))).filter(Boolean);
      existing.summary = input.summary === undefined ? existing.summary : normalizeText(input.summary);
      existing.tags = Array.from(new Set([...(existing.tags ?? []), ...(input.tags ?? [])].map(normalizeText))).filter(Boolean);
      existing.attributes = {
        ...existing.attributes,
        ...(input.attributes ?? {}),
      };
      existing.confidence = clamp01(input.confidence, existing.confidence);
      existing.updatedAt = now;
      await this.persist();
      return publicEntity(existing);
    }
    const created: WorldEntity = {
      id: createId("world"),
      type,
      name,
      aliases: Array.from(new Set((input.aliases ?? []).map(normalizeText))).filter(Boolean),
      summary: normalizeText(input.summary ?? ""),
      tags: Array.from(new Set((input.tags ?? []).map(normalizeText))).filter(Boolean),
      attributes: { ...(input.attributes ?? {}) },
      confidence: clamp01(input.confidence, 0.75),
      createdAt: now,
      updatedAt: now,
    };
    this.state.entities.push(created);
    await this.persist();
    return publicEntity(created);
  }

  findEntities(query: string, limit = 10): WorldEntity[] {
    this.assertInitialized();
    const normalized = normalizeText(query).toLowerCase();
    const capped = Math.min(50, Math.max(1, limit));
    if (!normalized) {
      return this.state.entities
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, capped)
        .map(publicEntity);
    }
    return this.state.entities
      .map((entity) => ({
        entity,
        score: this.scoreEntity(entity, normalized),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || right.entity.updatedAt - left.entity.updatedAt)
      .slice(0, capped)
      .map((item) => publicEntity(item.entity));
  }

  async addRelation(input: AddWorldRelationInput): Promise<WorldRelation> {
    this.assertInitialized();
    if (!this.state.entities.some((entity) => entity.id === input.fromId)) {
      throw new Error(`World relation fromId not found: ${input.fromId}`);
    }
    if (!this.state.entities.some((entity) => entity.id === input.toId)) {
      throw new Error(`World relation toId not found: ${input.toId}`);
    }
    const type = normalizeText(input.type);
    if (!type) {
      throw new Error("World relation type cannot be empty.");
    }
    const existing = this.state.relations.find(
      (relation) =>
        relation.fromId === input.fromId &&
        relation.toId === input.toId &&
        relation.type.toLowerCase() === type.toLowerCase(),
    );
    if (existing) {
      return publicRelation(existing);
    }
    const relation: WorldRelation = {
      id: createId("rel"),
      fromId: input.fromId,
      toId: input.toId,
      type,
      confidence: clamp01(input.confidence, 0.75),
      metadata: { ...(input.metadata ?? {}) },
      createdAt: Date.now(),
    };
    this.state.relations.push(relation);
    await this.persist();
    return publicRelation(relation);
  }

  listRelations(entityId?: string, limit = 50): WorldRelation[] {
    this.assertInitialized();
    return this.state.relations
      .filter((relation) => !entityId || relation.fromId === entityId || relation.toId === entityId)
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, Math.min(200, Math.max(1, limit)))
      .map(publicRelation);
  }

  snapshot(): WorldState {
    this.assertInitialized();
    return {
      entities: this.state.entities.map(publicEntity),
      relations: this.state.relations.map(publicRelation),
    };
  }

  async deleteEntitiesByTag(tag: string): Promise<{ entitiesDeleted: number; relationsDeleted: number }> {
    this.assertInitialized();
    const deletedIds = new Set(
      this.state.entities.filter((entity) => entity.tags.includes(tag)).map((entity) => entity.id),
    );
    if (deletedIds.size === 0) {
      return { entitiesDeleted: 0, relationsDeleted: 0 };
    }
    const entityCount = this.state.entities.length;
    const relationCount = this.state.relations.length;
    this.state.entities = this.state.entities.filter((entity) => !deletedIds.has(entity.id));
    this.state.relations = this.state.relations.filter(
      (relation) => !deletedIds.has(relation.fromId) && !deletedIds.has(relation.toId),
    );
    await this.persist();
    return {
      entitiesDeleted: entityCount - this.state.entities.length,
      relationsDeleted: relationCount - this.state.relations.length,
    };
  }

  private scoreEntity(entity: WorldEntity, query: string): number {
    const haystack = [
      entity.name,
      entity.summary,
      entity.type,
      ...entity.aliases,
      ...entity.tags,
      ...Object.values(entity.attributes)
        .filter((value) => typeof value === "string" || typeof value === "number")
        .map(String),
    ]
      .join(" ")
      .toLowerCase();
    if (entity.name.toLowerCase() === query) {
      return 10;
    }
    if (entity.name.toLowerCase().includes(query)) {
      return 6;
    }
    if (haystack.includes(query)) {
      return 3;
    }
    const terms = query.split(/\s+/).filter(Boolean);
    return terms.filter((term) => haystack.includes(term)).length;
  }

  private async persist(): Promise<void> {
    await fs.writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("WorldStore must be initialized before use.");
    }
  }
}
