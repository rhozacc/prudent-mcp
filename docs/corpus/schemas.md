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
        },
        "citation_aliases": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "kind": {
          "type": "string",
          "enum": [
            "article",
            "paragraph",
            "point",
            "section",
            "chapter",
            "annex"
          ]
        },
        "obligation": {
          "type": "string",
          "enum": [
            "must",
            "should",
            "may",
            "none"
          ]
        },
        "pages": {
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1
          }
        },
        "anchor": {
          "type": "string"
        },
        "is_metadata_only": {
          "type": "boolean"
        },
        "cites": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "framework": {
                "type": "string"
              },
              "citation": {
                "type": "string"
              },
              "document_id": {
                "type": "string"
              }
            },
            "required": [
              "framework",
              "citation"
            ],
            "additionalProperties": false
          }
        },
        "heading_path": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "role": {
          "type": "string",
          "enum": [
            "operative",
            "definition",
            "scope",
            "transitional",
            "background",
            "annex"
          ]
        },
        "amends": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "target": {
                "type": "string",
                "pattern": "^regulation:\\/\\/.+"
              },
              "op": {
                "type": "string",
                "enum": [
                  "replace",
                  "insert_after",
                  "delete"
                ]
              },
              "effective_from": {
                "type": "string",
                "format": "date"
              }
            },
            "required": [
              "target",
              "op",
              "effective_from"
            ],
            "additionalProperties": false
          }
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
        "primary_basis": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^regulation:\\/\\/.+"
          }
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
        "primary_basis": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^regulation:\\/\\/.+"
          }
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

<details>
<summary><code>Source</code></summary>

```json
{
  "$ref": "#/definitions/Source",
  "definitions": {
    "Source": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^source:\\/\\/.+"
        },
        "title": {
          "type": "string"
        },
        "framework": {
          "type": "string"
        },
        "document_id": {
          "type": "string"
        },
        "doc_type": {
          "type": "string",
          "enum": [
            "regulation",
            "guideline",
            "guide",
            "consultation",
            "statement",
            "report",
            "other"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "current",
            "pending",
            "superseded"
          ]
        },
        "published": {
          "type": "string",
          "format": "date"
        },
        "effective_from": {
          "type": "string",
          "format": "date"
        },
        "verified": {
          "type": "string",
          "format": "date"
        },
        "superseded_by": {
          "type": "string",
          "pattern": "^source:\\/\\/.+"
        },
        "milestones": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "date": {
                "type": "string"
              },
              "event": {
                "type": "string"
              }
            },
            "required": [
              "date",
              "event"
            ],
            "additionalProperties": false
          },
          "default": []
        },
        "url": {
          "type": "string"
        },
        "notes": {
          "type": "string"
        },
        "coverage": {
          "type": "string",
          "enum": [
            "full",
            "partial"
          ]
        },
        "pending_changes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title": {
                "type": "string"
              },
              "reference": {
                "type": "string"
              },
              "status": {
                "type": "string",
                "enum": [
                  "announced",
                  "adopted"
                ]
              },
              "effective_from": {
                "type": "string",
                "format": "date"
              },
              "ingested": {
                "type": "boolean"
              },
              "affects": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "affects_ids": {
                "type": "array",
                "items": {
                  "type": "string",
                  "pattern": "^regulation:\\/\\/.+"
                }
              },
              "note": {
                "type": "string"
              },
              "url": {
                "type": "string"
              }
            },
            "required": [
              "title",
              "status",
              "ingested"
            ],
            "additionalProperties": false
          }
        },
        "citation_style": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "eba-gl",
                "ecb-guide",
                "eu-regulation",
                "generic"
              ]
            },
            "chapters": {
              "type": "object",
              "additionalProperties": {
                "type": "string"
              }
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "id",
        "title",
        "framework",
        "document_id",
        "doc_type",
        "status",
        "verified"
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
<summary><code>Milestone</code></summary>

```json
{
  "$ref": "#/definitions/Milestone",
  "definitions": {
    "Milestone": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string"
        },
        "event": {
          "type": "string"
        }
      },
      "required": [
        "date",
        "event"
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
              "playbook",
              "source"
            ]
          }
        },
        "coverage": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "stale_sources": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^source:\\/\\/.+"
          },
          "default": []
        },
        "holdings": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "document_id": {
                "type": "string"
              },
              "framework": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "records": {
                "type": "integer"
              },
              "partial": {
                "type": "boolean"
              }
            },
            "required": [
              "document_id",
              "framework",
              "records"
            ],
            "additionalProperties": false
          }
        },
        "pending_changes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "source": {
                "type": "string",
                "pattern": "^source:\\/\\/.+"
              },
              "document_id": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "reference": {
                "type": "string"
              },
              "status": {
                "type": "string",
                "enum": [
                  "announced",
                  "adopted"
                ]
              },
              "effective_from": {
                "type": "string",
                "format": "date"
              },
              "state": {
                "type": "string",
                "enum": [
                  "upcoming",
                  "in_force_not_ingested",
                  "undated"
                ]
              }
            },
            "required": [
              "source",
              "document_id",
              "title",
              "status",
              "state"
            ],
            "additionalProperties": false
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
        },
        "primary": {
          "type": "object",
          "properties": {
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
            }
          },
          "additionalProperties": false,
          "default": {
            "tests": [],
            "checks": []
          }
        }
      },
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>CitationResolution</code></summary>

```json
{
  "$ref": "#/definitions/CitationResolution",
  "definitions": {
    "CitationResolution": {
      "type": "object",
      "properties": {
        "match": {
          "anyOf": [
            {
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
                },
                "citation_aliases": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "kind": {
                  "type": "string",
                  "enum": [
                    "article",
                    "paragraph",
                    "point",
                    "section",
                    "chapter",
                    "annex"
                  ]
                },
                "obligation": {
                  "type": "string",
                  "enum": [
                    "must",
                    "should",
                    "may",
                    "none"
                  ]
                },
                "pages": {
                  "type": "array",
                  "items": {
                    "type": "integer",
                    "minimum": 1
                  }
                },
                "anchor": {
                  "type": "string"
                },
                "is_metadata_only": {
                  "type": "boolean"
                },
                "cites": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "framework": {
                        "type": "string"
                      },
                      "citation": {
                        "type": "string"
                      },
                      "document_id": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "framework",
                      "citation"
                    ],
                    "additionalProperties": false
                  }
                },
                "heading_path": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "role": {
                  "type": "string",
                  "enum": [
                    "operative",
                    "definition",
                    "scope",
                    "transitional",
                    "background",
                    "annex"
                  ]
                },
                "amends": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "target": {
                        "type": "string",
                        "pattern": "^regulation:\\/\\/.+"
                      },
                      "op": {
                        "type": "string",
                        "enum": [
                          "replace",
                          "insert_after",
                          "delete"
                        ]
                      },
                      "effective_from": {
                        "type": "string",
                        "format": "date"
                      }
                    },
                    "required": [
                      "target",
                      "op",
                      "effective_from"
                    ],
                    "additionalProperties": false
                  }
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
            },
            {
              "type": "null"
            }
          ]
        },
        "confidence": {
          "type": "string",
          "enum": [
            "exact",
            "segment",
            "alias",
            "none"
          ]
        },
        "candidates": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^regulation:\\/\\/.+"
              },
              "citation": {
                "type": "string"
              },
              "document_id": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "citation",
              "document_id"
            ],
            "additionalProperties": false
          },
          "default": []
        },
        "ambiguous": {
          "type": "boolean",
          "default": false
        },
        "unmatched_segments": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": []
        },
        "coverage_note": {
          "type": "string"
        }
      },
      "required": [
        "match",
        "confidence"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>

<details>
<summary><code>ExternalCitation</code></summary>

```json
{
  "$ref": "#/definitions/ExternalCitation",
  "definitions": {
    "ExternalCitation": {
      "type": "object",
      "properties": {
        "framework": {
          "type": "string"
        },
        "citation": {
          "type": "string"
        },
        "document_id": {
          "type": "string"
        }
      },
      "required": [
        "framework",
        "citation"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

</details>
