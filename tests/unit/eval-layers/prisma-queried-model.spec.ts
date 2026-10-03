import { buildPersonalDataInventoryFromIngest, ensureDeclarationEngine } from "../../../src/eval-layers/personal-data-inventory";
import type { FileInfo } from "../../../src/core/types/file";

function file(path: string, lines: string[]): FileInfo {
  const content = lines.join("\n");
  return { path, name: path.split("/").pop() as string, language: "typescript", content, size: content.length };
}

describe("Prisma client calls name their model", () => {
  beforeAll(async () => {
    await ensureDeclarationEngine();
  });

  it("gives an occurrence inside a multi-line Prisma model call that model as its table", () => {
    const source = file("lib/booking.ts", [
      "export async function book(prisma: any, bookerEmail: string) {", // 1
      "  await prisma.attendee.create({", //                              2
      "    data: {", //                                                   3
      "      name: 'x',", //                                              4
      "      email: bookerEmail,", //                                     5
      "    },", //                                                        6
      "  });", //                                                         7
      "  await prisma.bookingReport.findMany({ where: { bookerEmail } });", // 8
      "  return bookerEmail;", //                                         9
      "}", //                                                             10
    ]);
    const { hits } = buildPersonalDataInventoryFromIngest([source], []);
    const tableAt = (line: number) => hits.find((hit) => hit.id === "email" && hit.evidence.endLine === line)?.tableEntity;
    expect([tableAt(5), tableAt(8), tableAt(9)]).toEqual(["attendee", "booking_report", undefined]);
  });
});
