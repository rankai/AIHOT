import { WordSource } from "./word-check-contract.ts";
import { z } from "zod";
import { Size } from "../providers/redfox/image-models.ts";
export const TaskChoice = z.object({skillId:z.string(),moduleId:z.string(),delivery:z.enum(['writing','plans-only','image','title-report','word-check']),size:Size.optional(),wordSource:WordSource.optional()}).strict();
export type TaskChoiceValue = z.infer<typeof TaskChoice>;
