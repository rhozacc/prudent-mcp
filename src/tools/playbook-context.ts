/**
 * The playbook context (provisions, sources, checks, tests, playbooks) read from the adapters, once per set of lists.
 * The renderer and verifier read plain maps; building them over a corpus on every call would cost more than the render.
 */
import { adapters } from "../adapters.ts";
import { playbookContext, type PlaybookContext } from "../playbook-context.ts";

const cache = new WeakMap<object, PlaybookContext>();

export async function servedPlaybookContext(): Promise<PlaybookContext> {
  const [regulations, sources, checks, tests, playbooks] = await Promise.all([
    adapters.regulation.list(),
    adapters.source.list(),
    adapters.check.list(),
    adapters.test.list(),
    adapters.playbook.list(),
  ]);
  const hit = cache.get(playbooks);
  if (hit !== undefined && hit.regulations.size === regulations.length) return hit;
  const ctx = playbookContext({ regulations, sources, checks, tests, playbooks });
  cache.set(playbooks, ctx);
  return ctx;
}
