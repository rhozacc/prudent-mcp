/** The shape of a note. Its own file so the search envelope can name it without importing the tools that write notes. */
import { z } from "zod";

export const NOTE_TYPES = ["amendment", "version", "outside_library", "placeholder", "weak_match"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export interface Note {
  type: NoteType;
  text: string;
  /** Official citations of the provisions the note concerns, when it is about particular ones. */
  applies_to?: string[];
}

export const NoteSchema = z.object({
  type: z.enum(NOTE_TYPES),
  text: z.string().describe("Written to be repeated to the user as it stands."),
  applies_to: z.array(z.string()).optional().describe("Official citations of the provisions the note concerns."),
});
export const notesShape = {
  notes: z
    .array(NoteSchema)
    .optional()
    .describe("Caveats the answer must carry: an amendment, a version, an instrument the library lacks, a placeholder, a weak match. Absent when there are none."),
};

