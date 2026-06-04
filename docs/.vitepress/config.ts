import { defineConfig } from "vitepress";

export default defineConfig({
  title: "prudent-mcp",
  description: "Structured regulatory knowledge for IRB credit-risk model validation",
  base: "/prudent-mcp/",
  themeConfig: {
    nav: [
      { text: "Guide",    link: "/guide/" },
      { text: "Tools",    link: "/tools/" },
      { text: "Corpus",   link: "/corpus/" },
      { text: "Examples", link: "/examples/" },
      { text: "FAQ",      link: "/guide/faq" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction",  link: "/guide/" },
          { text: "Concepts",      link: "/guide/concepts" },
          { text: "Quickstart",    link: "/guide/quickstart" },
          { text: "Architecture",  link: "/guide/architecture" },
          { text: "Clients",       link: "/guide/clients" },
          { text: "FAQ",           link: "/guide/faq" },
        ],
      },
      {
        text: "Tools",
        items: [
          { text: "Overview",   link: "/tools/" },
          { text: "Meta",       link: "/tools/meta" },
          { text: "Regulation", link: "/tools/regulation" },
          { text: "Tests",      link: "/tools/tests" },
          { text: "Checks",     link: "/tools/checks" },
          { text: "Playbooks",  link: "/tools/playbooks" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Corpus structure", link: "/corpus/" },
          { text: "Schema reference", link: "/corpus/schemas" },
          { text: "Corpus graph",     link: "/corpus/graph" },
          { text: "Prompts",          link: "/prompts/" },
          { text: "Adapters",         link: "/adapters/" },
        ],
      },
      { text: "Examples", link: "/examples/" },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/rhozacc/prudent-mcp" },
    ],
    search: { provider: "local" },
  },
});
