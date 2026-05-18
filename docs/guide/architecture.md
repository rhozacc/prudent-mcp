# Architecture

Two diagrams: schema relationships, and the request flow from MCP client through to adapter.

## Schema relationships

```mermaid
classDiagram
    class Regulation {
        +RegulationId id
        +string framework
        +string document_id
        +string document_version
        +string citation
        +string text
        +Commentary[] commentary
    }

    class Commentary {
        +string source
        +string text
        +string? last_updated
    }

    class Test {
        +TestId id
        +string name
        +string[] aliases
        +string? family
        +string purpose
        +string? acceptance_criteria
        +RegulationId[] regulatory_basis
        +string last_updated
    }

    class Check {
        +CheckId id
        +string name
        +RegulationId[] derived_from
        +string expectation
        +string[] expected_evidence
        +string last_updated
    }

    class Playbook {
        +PlaybookId id
        +string area
        +string? subarea
        +Phase[] phases
        +string[] gates
        +string last_updated
    }

    class Phase {
        +string name
        +string description
        +AnyId[] references
    }

    class ReviewArea {
        +string id
        +string name
        +string? parent
        +string[] children
    }

    class CorpusInfo {
        +string last_updated
        +Map~Surface,number~ counts
        +string[] coverage
    }

    class Referrers {
        +RegulationId[] regulation
        +TestId[] tests
        +CheckId[] checks
        +PlaybookId[] playbooks
    }

    Regulation "1" *-- "many" Commentary : carries
    Playbook "1" *-- "many" Phase : has
    Check ..> Regulation : derived_from
    Test ..> Regulation : regulatory_basis
    Phase ..> Regulation : references
    Phase ..> Test : references
    Phase ..> Check : references
    ReviewArea ..> ReviewArea : parent / children
```

The dashed arrows are cross-surface references — the places where template literal types catch wrong-surface IDs at compile time.

## Request flow

```mermaid
flowchart LR
    Client[MCP client<br/>e.g. Claude Desktop]
    Server[McpServer<br/>src/server.ts]
    Tools[Tool handler<br/>src/tools/*.ts]
    Adapters[adapters object<br/>src/adapters.ts]
    Backend[(Real corpus<br/>or in-memory demo)]

    Client -->|JSON-RPC| Server
    Server -->|registered handler| Tools
    Tools -->|adapters.regulation.get| Adapters
    Adapters -->|delegate| Backend
    Backend -->|Regulation| Adapters
    Adapters -->|Regulation| Tools
    Tools -->|JSON content| Server
    Server -->|JSON-RPC| Client
```

The `adapters` object is the seam. Default implementations return empty; `examples/inmemory-demo.ts` reassigns the handles to seed in-memory data, and a backend adapter would do the same against its own storage.
