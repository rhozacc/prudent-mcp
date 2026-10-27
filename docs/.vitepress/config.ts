import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(defineConfig({
  title: "prudent-mcp",
  description: "Structured regulatory knowledge for IRB credit-risk model validation",
  base: "/prudent-mcp/",
  head: [
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        // Inter is already self-hosted by the VitePress default theme; only the
        // mono face needs loading.
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  ],
  themeConfig: {
    nav: [
      { text: "Quickstart", link: "/guide/quickstart" },
      { text: "Tools",      link: "/tools/" },
      { text: "Examples",   link: "/examples/" },
      { text: "Corpus",     link: "/corpus/" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Quickstart",    link: "/guide/quickstart" },
          { text: "Clients",       link: "/guide/clients" },
          { text: "Architecture",  link: "/guide/architecture" },
        ],
      },
      {
        text: "Use",
        items: [
          { text: "Tools",    link: "/tools/" },
          { text: "Examples", link: "/examples/" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Corpus structure", link: "/corpus/" },
          { text: "Schema reference", link: "/corpus/schemas" },
          { text: "Corpus graph",     link: "/corpus/graph" },
          { text: "Adapters",         link: "/adapters/" },
          { text: "1.0 design",       link: "/design/1.0" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/rhozacc/prudent-mcp" },
    ],
    search: { provider: "local" },
  },
}));
