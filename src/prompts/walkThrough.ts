/**
 * `walk_through`: one prompt, for working a topic from the playbook down to the provisions.
 *
 * It replaces the three 0.x scaffolds, which were shaped around one kind of caller. It asks for nothing the tools do not
 * already give: the playbook first, then the requirements one by one, with the provisions opened where the work needs them.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "walk_through",
    {
      title: "Walk through a topic",
      description: "Work a topic requirement by requirement: the playbook first, then the provisions behind each requirement.",
      argsSchema: {
        topic: z.string().describe("The topic or question, in your own words."),
        focus: z.string().optional().describe("What you are doing with it: developing, validating, reviewing, preparing for a supervisor."),
      },
    },
    ({ topic, focus }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Walk me through: ${topic}${focus === undefined ? "" : ` (I am ${focus})`}.\n\n` +
              "1. Call brief with the topic as the question and read the playbook it returns.\n" +
              "2. Go through the requirements in order. For each, say what has to be shown, which provision it rests on (cite it officially) and what a reviewer will ask to see. Open a requirement in full with playbook (section) where its wording matters.\n" +
              "3. Keep law, EBA guidelines, ECB supervisory expectations and market practice apart, as the playbook labels them.\n" +
              "4. Repeat every note that comes back: amendments with their dates, versions, instruments the library does not hold.\n" +
              "5. End with the pitfalls that apply to my situation and anything the library does not cover, marked as such.",
          },
        },
      ],
    }),
  );
}
