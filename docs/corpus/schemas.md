---
title: Schema reference
---

# Schema reference

> **Auto-generated** by `bun run schema-docs` from `src/schema.ts` — do not edit by hand. For the reasoning behind each field, read [Corpus structure](/corpus/). The same definitions are emitted as standalone files under `docs/schemas/*.schema.json` for adapter build pipelines.

Each block is the JSON Schema (draft-07) for one corpus type. Expand to read the field-level contract.

## Surfaces

<details>
<summary><code>Regulation</code></summary>

```json
{
  "$ref": "#/definitions/Regulation",
  "definitions": {
    "Regulation": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^regulation:\\/\\/.+"
        },
        "framework": {
          "type": "string"
        },
        "document_id": {
          "type": "string"
        },
        "document_version": {
          "type": "string"
        },
        "citation": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "commentary": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "source": {
                "type": "string"
              },
              "text": {
                "type": "string"
              },
              "last_updated": {
                "type": "string",
                "format": "date"
              }
            },
            "required": [
              "source",
              "text"
            ],
            "additionalProperties": false
          },
          "default": []
        },
        "parent": {
          "type": "string",
          "pattern": "^regulation:\\/\\/.+"
        },
        "children": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^regulation:\\/\\/.+"
              },
              {
                "type": "string",
                "pattern": "^test:\\/\\/.+"
              },
              {
                "type": "string",
                "pattern": "^check:\\/\\/.+"
              }
            ]
          },
          "default": []
        }
      },
      "required": [
        "id",
        "framework",
        "document_id",
        "document_version",
        "citation",
        "text"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>Test</code></summary>

```json
{
  "$ref": "#/definitions/Test",
  "definitions": {
    "Test": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^test:\\/\\/.+"
        },
        "name": {
          "type": "string"
        },
        "aliases": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": []
        },
        "family": {
          "type": "string"
        },
        "purpose": {
          "type": "string"
        },
        "acceptance_criteria": {
          "type": "string"
        },
        "regulatory_basis": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^regulation:\\/\\/.+"
          },
          "default": []
        },
        "parent": {
          "type": "string",
          "pattern": "^regulation:\\/\\/.+"
        },
        "last_updated": {
          "type": "string",
          "format": "date"
        }
      },
      "required": [
        "id",
        "name",
        "purpose",
        "last_updated"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>Check</code></summary>

```json
{
  "$ref": "#/definitions/Check",
  "definitions": {
    "Check": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^check:\\/\\/.+"
        },
        "name": {
          "type": "string"
        },
        "derived_from": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^regulation:\\/\\/.+"
          },
          "default": []
        },
        "parent": {
          "type": "string",
          "pattern": "^regulation:\\/\\/.+"
        },
        "expectation": {
          "type": "string"
        },
        "expected_evidence": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": []
        },
        "last_updated": {
          "type": "string",
          "format": "date"
        }
      },
      "required": [
        "id",
        "name",
        "expectation",
        "last_updated"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>Playbook</code></summary>

```json
{
  "$ref": "#/definitions/Playbook",
  "definitions": {
    "Playbook": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^playbook:\\/\\/.+"
        },
        "area": {
          "type": "string"
        },
        "subarea": {
          "type": "string"
        },
        "phases": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "references": {
                "type": "array",
                "items": {
                  "anyOf": [
                    {
                      "type": "string",
                      "pattern": "^regulation:\\/\\/.+"
                    },
                    {
                      "type": "string",
                      "pattern": "^test:\\/\\/.+"
                    },
                    {
                      "type": "string",
                      "pattern": "^check:\\/\\/.+"
                    },
                    {
                      "type": "string",
                      "pattern": "^playbook:\\/\\/.+"
                    }
                  ]
                },
                "default": []
              }
            },
            "required": [
              "name",
              "description"
            ],
            "additionalProperties": false
          },
          "default": []
        },
        "gates": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": []
        },
        "regulatory_scope": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^regulation:\\/\\/.+"
          },
          "default": []
        },
        "last_updated": {
          "type": "string",
          "format": "date"
        }
      },
      "required": [
        "id",
        "area",
        "last_updated"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

## Supporting types

<details>
<summary><code>Commentary</code></summary>

```json
{
  "$ref": "#/definitions/Commentary",
  "definitions": {
    "Commentary": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "last_updated": {
          "type": "string",
          "format": "date"
        }
      },
      "required": [
        "source",
        "text"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>Phase</code></summary>

```json
{
  "$ref": "#/definitions/Phase",
  "definitions": {
    "Phase": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "references": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^regulation:\\/\\/.+"
              },
              {
                "type": "string",
                "pattern": "^test:\\/\\/.+"
              },
              {
                "type": "string",
                "pattern": "^check:\\/\\/.+"
              },
              {
                "type": "string",
                "pattern": "^playbook:\\/\\/.+"
              }
            ]
          },
          "default": []
        }
      },
      "required": [
        "name",
        "description"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>ReviewArea</code></summary>

```json
{
  "$ref": "#/definitions/ReviewArea",
  "definitions": {
    "ReviewArea": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parent": {
          "type": "string"
        },
        "children": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": []
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>CorpusInfo</code></summary>

```json
{
  "$ref": "#/definitions/CorpusInfo",
  "definitions": {
    "CorpusInfo": {
      "type": "object",
      "properties": {
        "last_updated": {
          "type": "string",
          "format": "date-time"
        },
        "counts": {
          "type": "object",
          "additionalProperties": {
            "type": "number"
          },
          "propertyNames": {
            "enum": [
              "regulation",
              "test",
              "check",
              "playbook"
            ]
          }
        },
        "coverage": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "last_updated",
        "counts",
        "coverage"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>Referrers</code></summary>

```json
{
  "$ref": "#/definitions/Referrers",
  "definitions": {
    "Referrers": {
      "type": "object",
      "properties": {
        "regulation": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^regulation:\\/\\/.+"
          },
          "default": []
        },
        "tests": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^test:\\/\\/.+"
          },
          "default": []
        },
        "checks": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^check:\\/\\/.+"
          },
          "default": []
        },
        "playbooks": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^playbook:\\/\\/.+"
          },
          "default": []
        }
      },
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>
