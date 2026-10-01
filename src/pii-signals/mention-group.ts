import { appendFileSync } from "fs";
/**
 * First-pass grouping of code mentions into data items (KDATAP-c8a46a).
 *
 * One signal concept such as `email` usually covers several real data items: a
 * member's account email, a staff user's email, a newsletter sender address. This
 * grouper reads the qualifier on the matched line:
 *
 * - a compound identifier around the concept: `sender_email`, `customerEmail`
 * - otherwise the receiver of a property read: `member.email`, `order.get('email')`
 *
 * Generic words (`recipient`, `new`, `data`, `user`, ...) are not qualifiers, since
 * they name a role or a container rather than whose data it is. Mentions without a
 * qualifier get no group and are scored as singletons. Precision comes first; later
 * passes resolve declarations and value flow (KDATAP-a565be).
 */

const GENERIC_WORDS = new Set([
  "a", "addr", "address", "addresses", "args", "attributes", "attrs", "body", "check", "clean", "cleaned",
  "ctx", "current", "data", "default", "e", "existing", "field", "format", "from", "get",
  "has", "id", "ids", "info", "input", "instance", "is", "it", "item", "list", "lower", "m",
  "main", "model", "models", "new", "normalized", "obj", "object", "of", "old", "options", "opts",
  "params", "parse", "parts", "parser", "payload", "props", "raw", "record", "recipient", "recipients",
  "remove", "req", "result", "row", "self", "send", "service", "set", "str", "target", "task",
  "key", "the", "this", "to", "trimmed", "u", "update", "user", "valid", "validate", "validated",
  "validation", "validations", "value", "verify", "with", "x",
]);

const LOOKUP_WORDS = new Set(["by", "for", "from", "with", "to"]);

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

export function identifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-\s.]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The qualifier naming whose data a mention of the signal on this line is, or
 * undefined when the line has none. `signalId` is the signal's snake_case id.
 */
export function mentionQualifier(line: string, signalId: string): string | undefined {
  return qualify(line, signalId)?.qualifier;
}

/**
 * The qualifier plus where it came from: `fromReceiver` is true when it is only the
 * name of the receiver variable (`owner.get('email')` -> `owner`), which a resolved
 * receiver class may replace (`User`), unlike a compound identifier naming the concept.
 */
/**
 * `fromReceiver`: a typed receiver may replace the qualifier. `weak`: the qualifier is only
 * a receiver variable's name (`profile.email`), applied after stronger evidence.
 */
export function qualify(
  line: string,
  signalId: string,
): { qualifier: string; fromReceiver: boolean; weak?: boolean } | undefined {
  const conceptWords = identifierWords(signalId);
  // The first qualified identifier wins, unless a later one on the line is a more
  // specific form of it: `customer_email = get_customer_email_for_voucher_usage(...)`
  // -> `customer_for_voucher_usage`, since the value comes from that source.
  let chosen: string[] | undefined;
  for (const match of line.matchAll(IDENTIFIER)) {
    const identifier = match[0];
    // A function name describes an action, not whose data it is (`getByEmail`,
    // `sendWelcomeEmail`); call links join its parameters to callers instead.
    // A callee on the right of an assignment still names the value's source.
    const after = line.slice((match.index ?? 0) + identifier.length);
    const before = line.slice(0, match.index ?? 0);
    // A callee still names the value's source when its result is assigned to a concept
    // variable: `customer_email = get_customer_email_for_voucher_usage(...)`, but not
    // `const user = await this.getUserByEmail(email)`.
    const assignment = /^(.*?)(?:^|[^=!<>])=(?!=)/.exec(before);
    const assignsConcept =
      assignment !== null &&
      (assignment[1].match(IDENTIFIER) ?? []).some((name) => {
        const nameWords = identifierWords(name);
        return conceptWords.every((word) => nameWords.includes(word));
      });
    // Also a function defined by assignment: `findOneByEmail = async (email) => ...`,
    // `sendEmail: async (to) => ...`, `x = function (...)`.
    const isFunctionName =
      (/^\s*(\(|:\s*(async\s+)?function\b)/.test(after) ||
        /^\s*[:=]\s*(async\s+)?(function\b|\([^)]*\)\s*(:\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/.test(after)) &&
      !assignsConcept;
    const words = identifierWords(identifier);
    // A getter named for whose value it returns keeps its qualifier:
    // `get_customer_email()` -> customer. Lookups (`getByEmail`) and actions
    // (`sendWelcomeEmail`) do not.
    const isGetter =
      words[0] === "get" &&
      conceptWords.every((word, index) => words[words.length - conceptWords.length + index] === word) &&
      !words.some((word) => LOOKUP_WORDS.has(word));
    if (isFunctionName && !isGetter) continue;
    if (!conceptWords.every((word) => words.includes(word)) || words.length === conceptWords.length) {
      continue;
    }
    // The concept as a leading modifier names a feature, not whose data it is:
    // emailSuppressionList, email_service, emailTemplate.
    if (conceptWords.every((word, index) => words[index] === word)) continue;
    // "... by email" names a lookup, never an owner: findOneByEmail, resetPasswordByEmail
    // (also as a shorthand export entry, where no call follows the name).
    const conceptAt = words.indexOf(conceptWords[0]);
    // A role (used_by_email, created_by_email, assigned_to_email) starts with a past
    // participle and keeps its qualifier.
    if (conceptAt > 0 && LOOKUP_WORDS.has(words[conceptAt - 1]) && !words[0].endsWith("ed")) continue;
    const qualifiers = words.filter((word) => !GENERIC_WORDS.has(word) && !conceptWords.includes(word));
    if (qualifiers.length === 0) continue;
    if (!chosen) {
      chosen = qualifiers;
    } else if (qualifiers.length > chosen.length && chosen.every((word) => qualifiers.includes(word))) {
      chosen = qualifiers;
    }
  }
  if (chosen) {
    // A local copy of a bare concept read keeps the source's identity:
    // `const parentMemberEmail = parentMember.get('email')` -> member,
    // `const verificationEmail = user?.email ?? input.email` -> user. Only true locals;
    // `gift_card.used_by_email = user.email` stores a copy in another entity and keeps
    // its own name.
    const localCopy = new RegExp(
      `^\\s*(?:(?:const|let|var)\\s+)?([A-Za-z_]\\w*)\\s*(?::\\s*[\\w<>\\[\\]| ]+)?\\s*=\\s*(?:await\\s+)?(?:[\\w.]+\\s*\\?\\?\\s*)?([A-Za-z_]\\w*)\\s*(?:\\?\\.|\\.|\\[\\s*['"]|\\.get\\(\\s*['"])${conceptWords.map(escapeRegExp).join("_?")}\\b`,
      "i",
    ).exec(line);
    if (localCopy && conceptWords.every((word) => identifierWords(localCopy[1]).includes(word))) {
      const source = /^users?$/i.test(localCopy[2])
        ? "user"
        : identifierWords(localCopy[2]).filter((word) => !GENERIC_WORDS.has(word)).pop();
      if (source) return { qualifier: source, fromReceiver: true };
    }
    return { qualifier: chosen.join("_"), fromReceiver: false };
  }
  const conceptPattern = conceptWords.map(escapeRegExp).join("[_]?");
  const receiver = new RegExp(
    `((?:[A-Za-z_$][\\w$]*\\s*\\??\\.\\s*)*[A-Za-z_$][\\w$]*)\\s*(?:\\??\\.|\\[\\s*['"]|\\.get\\(\\s*['"])${conceptPattern}\\b`,
    "i",
  ).exec(line);
  if (receiver) {
    // Walk the receiver chain from the right to the first segment that names an owner:
    // member._changed.email and member._previousAttributes.email -> member. A segment
    // named exactly `user` names the user entity, although `user` is generic elsewhere.
    const segments = receiver[1].split(/\s*\??\.\s*/).reverse();
    for (const segment of segments) {
      if (/^users?$/i.test(segment)) return { qualifier: "user", fromReceiver: true, weak: true };
      const words = identifierWords(segment).filter(
        (word) => !GENERIC_WORDS.has(word) && !INSTANCE_WORDS.has(word) && !STATE_WORDS.has(word),
      );
      if (words.length > 0) return { qualifier: singular(words[words.length - 1]), fromReceiver: true, weak: true };
    }
  }
  return undefined;
}

/** Group id for a code mention of a signal, e.g. `email:customer`, or undefined. */
export function mentionGroup(signalId: string, line: string): string | undefined {
  const qualifier = mentionQualifier(line, signalId);
  return qualifier ? `${signalId}:${qualifier}` : undefined;
}

// A file whose folder names its role (models/, services/, controllers/, ...) or whose name
// ends in -repository is about one entity: models/member.js, services/users.ts.
const MODEL_FILE =
  /(^|\/)(models?|services|controllers|repositories|resolvers|routes)\/[^/]+$|[-_](?:repository|service)\.[A-Za-z]+$|(^|\/)models?\.py$/;
const FILE_ROLE_WORDS = new Set([
  "repository", "model", "models", "index", "service", "services", "controller", "controllers",
  "resolver", "resolvers", "route", "routes",
]);

/**
 * The entity a model or repository file is about: `models/member.js` -> `member`,
 * `member-repository.js` -> `member`. Undefined for other files, and for files whose
 * name is only generic words (`models.py`, `user.js` since `user` is generic).
 */
/** Leading action words of command file names: create-user, block-user, reset-user-password. */
const COMMAND_ACTIONS = new Set([
  "create", "delete", "remove", "add", "update", "set", "reset", "block", "unblock", "active",
  "activate", "deactivate", "list", "get", "show", "import", "export", "sync", "send", "change",
]);

export function modelFileEntity(filePath: string): string | undefined {
  // A command file (cli/commands/admin/create-user.ts, management/commands/create_user.py)
  // is an action on one entity: the first word after a leading action word.
  if (/(^|\/)commands\/(?:[^/]+\/)?[^/]+$/.test(filePath)) {
    const commandWords = identifierWords(filePath.split("/").pop()!.replace(/\.[A-Za-z]+$/, ""));
    if (commandWords.length >= 2 && COMMAND_ACTIONS.has(commandWords[0])) {
      const entity = commandWords[1];
      return entity.length > 3 && entity.endsWith("s") && !entity.endsWith("ss") ? entity.slice(0, -1) : entity;
    }
    return undefined;
  }
  if (!MODEL_FILE.test(filePath)) return undefined;
  const base = filePath.split("/").pop()!.replace(/\.[A-Za-z]+$/, "");
  // Generic words are allowed here: in a model file, `user` names the model.
  const words = identifierWords(base).filter((word) => !FILE_ROLE_WORDS.has(word));
  const last = words[words.length - 1];
  if (!last) return undefined;
  return last.length > 3 && last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
}

/**
 * Group name of an entity field: the entity plus the field's own qualifier.
 * `member.email` -> `email:member`, `newsletter.sender_email` -> `email:newsletter_sender`,
 * `order.user_email` -> `email:order` (`user` is generic).
 */
function entityFieldName(signalId: string, fieldKey: string): string {
  const [entity, field] = [fieldKey.slice(0, fieldKey.indexOf(".")), fieldKey.slice(fieldKey.indexOf(".") + 1)];
  const fieldQualifier = mentionQualifier(field, signalId);
  return `${signalId}:${fieldQualifier ? `${entity}_${fieldQualifier}` : entity}`;
}

/**
 * The name a mention brings to grouping: the entity field it defines
 * (`sender_email` under `newsletters:` -> `email:newsletter_sender`), else the line's
 * qualifier. Reads keep the line's qualifier and reach the definition through field
 * links, so `gift_card.assigned_to_email` and `assigned_to_email=` stay compatible.
 */
function effectiveName(hit: GroupableHit): string | undefined {
  const defined = (hit.fieldKeys ?? []).find((field) => field.definition);
  return defined ? entityFieldName(hit.id, defined.key) : hit.group;
}

/** Words that describe the state of an object in a receiver chain (`member._changed.email`). */
const STATE_WORDS = new Set(["changed", "prev", "previous", "dirty", "pending", "cached"]);

/** Words that describe which copy of an object, not what the object is. */
const INSTANCE_WORDS = new Set(["original", "replace", "locked", "initial", "previous", "updated", "saved"]);

function singular(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/**
 * Normalized entity name of a class, table key, or variable: `Order` -> `order`,
 * `members` -> `member`, `original_order` -> `order`, `donationPaymentEvents` ->
 * `donation_payment_event`. Undefined when only generic words remain (`data`, `self`).
 */
export function entityName(name: string): string | undefined {
  const words = identifierWords(name)
    .filter((word) => !GENERIC_WORDS.has(word) && !INSTANCE_WORDS.has(word))
    .map(singular);
  return words.length > 0 ? words.join("_") : undefined;
}

const CLASS_ROLE_WORDS = new Set(["service", "services", "repository", "model", "controller", "manager", "provider"]);

/**
 * The entity a class stands for: role words dropped and singularized, so `UsersService`
 * -> `user`, `MemberRepository` -> `member`, `User` -> `user`. Unlike `entityName`, a
 * generic word such as `user` is kept: a class named `User` is that entity.
 */
/** Trailing words that name a wrapper around an entity rather than the entity. */
const CONTAINER_WORDS = new Set([
  "info", "data", "input", "payload", "dto", "record", "result", "details", "params",
  "options", "args", "attributes", "props", "text",
]);

export function classEntity(className: string): string | undefined {
  const words = identifierWords(className)
    .filter((word) => !CLASS_ROLE_WORDS.has(word))
    .map(singular);
  // UserInfo -> user; keep at least one word. Input and DTO types are named
  // verb + entity + wrapper (RegisterUserInput, CreateUserDto), so once a wrapper word
  // is stripped only the entity, the last remaining word, is kept.
  let stripped = false;
  while (words.length > 1 && CONTAINER_WORDS.has(words[words.length - 1])) {
    words.pop();
    stripped = true;
  }
  if (stripped) return words[words.length - 1];
  return words.length > 0 ? words.join("_") : undefined;
}

interface GroupableHit {
  id: string;
  location?: "code" | "comment";
  evidence: { filePath: string; endLine?: number };
  group?: string;
  receiverEntity?: string;
  tableEntity?: string;
  weakGroup?: boolean;
  declaration?: { line: number; kind: string; name?: string } | "unresolved";
  fieldKeys?: Array<{ key: string; definition: boolean }>;
  passedDeclarations?: Array<{ line: number; name: string }>;
  passedMentionLines?: number[];
  callLinks?: string[];
}

/** Id of a declaration node: signal, file, and 1-based line of the declaration. */
export function declarationNodeId(signalId: string, filePath: string, line: number, name?: string): string {
  return name ? `${signalId}@${filePath}:${line}#${name}` : `${signalId}@${filePath}:${line}`;
}

/**
 * Second pass: join code mentions that share a same-file declaration, then name each
 * joined set (KDATAP-c8a46a). A declaration never spans two data items in the labeled
 * corpus, so it is a safe join. Mentions joined through a declaration take the set's
 * qualifier group; a set with no qualifier is named after its declaration, e.g.
 * `email@src/a.js:12`. Sets that share a qualifier are joined too, so the qualifier
 * links declarations across files.
 */
export function assignDeclarationGroups<T extends GroupableHit>(hits: T[]): T[] {
  const refusedLog = process.env.DATAPARADE_REFUSED_LOG;
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    parent.set(node, root);
    return root;
  };
  // Each set carries at most one qualifier name. A join that would put two differently
  // named sets together is refused (cannot-link), so one bridging line never merges
  // `email:member` with `email:customer`.
  const nameOf = new Map<string, string>();
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a === b) return;
    const nameA = nameOf.get(a);
    const nameB = nameOf.get(b);
    if (nameA && nameB && nameA !== nameB) {
      // Cannot-link refusal: two differently named sets that this phase's evidence would
      // have joined. Logged for merge evaluation when DATAPARADE_REFUSED_LOG is set.
      if (refusedLog) {
        const index = left.startsWith("hit:") ? Number(left.slice(4)) : -1;
        const hit = index >= 0 ? hits[index] : undefined;
        appendFileSync(
          refusedLog,
          `${JSON.stringify({ phase, a: nameA, b: nameB, at: hit ? `${hit.evidence.filePath}:${hit.evidence.endLine ?? ""}` : left })}\n`,
        );
      }
      return;
    }
    parent.set(a, b);
    if (nameA && !nameB) nameOf.set(b, nameA);
  };
  const groupNode = (group: string): string => {
    const node = `group:${group}`;
    if (!parent.has(node)) {
      parent.set(node, node);
      nameOf.set(node, group);
    }
    return node;
  };
  const declarationNode = (hit: T): string | undefined =>
    hit.declaration && hit.declaration !== "unresolved"
      ? declarationNodeId(hit.id, hit.evidence.filePath, hit.declaration.line, hit.declaration.name)
      : undefined;

  // Joins run from most to least reliable: declaration (a declaration never spans two
  // data items in the labeled corpus), name, field, model file. A use of a variable
  // therefore follows its declaration's name rather than its own line's qualifier.
  let phase = "declaration";
  hits.forEach((hit, index) => {
    if (hit.location === "comment") return;
    const node = `hit:${index}`;
    parent.set(node, node);
    const declaration = declarationNode(hit);
    if (declaration) union(node, `decl:${declaration}`);
    for (const passed of hit.passedDeclarations ?? []) {
      union(node, `decl:${declarationNodeId(hit.id, hit.evidence.filePath, passed.line, passed.name)}`);
    }
    // Every code mention is also reachable by its own line, for passed-variable links.
    if (hit.evidence.endLine !== undefined) {
      union(node, `at:${hit.id}@${hit.evidence.filePath}:${hit.evidence.endLine}`);
    }
    for (const line of hit.passedMentionLines ?? []) {
      union(node, `at:${hit.id}@${hit.evidence.filePath}:${line}`);
    }
  });
  // A name from a receiver variable alone is weak: it waits until typed-receiver and
  // table evidence have named the set (see the weak-name phase below).
  const isWeak = (hit: T): boolean =>
    hit.weakGroup === true && !(hit.fieldKeys ?? []).some((field) => field.definition);
  phase = "name";
  hits.forEach((hit, index) => {
    if (hit.location === "comment" || isWeak(hit)) return;
    const name = effectiveName(hit);
    if (name) union(`hit:${index}`, groupNode(name));
  });

  // An entity field read (`order.user_email`, `member.get('email')`) joins the
  // definition of that field (`user_email` in class Order, `email` under `members:`).
  const definedFields = new Set(
    hits.flatMap((hit) => (hit.fieldKeys ?? []).filter((field) => field.definition).map((field) => `${hit.id}:${field.key}`)),
  );
  // A read on a line that already names its data item (`customer_email=checkout.email`)
  // is a copy into that item, so only definitions link there.
  phase = "field";
  hits.forEach((hit, index) => {
    if (hit.location === "comment") return;
    for (const field of hit.fieldKeys ?? []) {
      if (hit.group && !field.definition) continue;
      const node = `${hit.id}:${field.key}`;
      if (definedFields.has(node)) union(`hit:${index}`, `field:${node}`);
    }
  });

  // A value passed as a call argument keeps its data item in the callee's parameter,
  // so the mention joins the declaration of the parameter it is passed to.
  phase = "call";
  hits.forEach((hit, index) => {
    if (hit.location === "comment") return;
    for (const link of hit.callLinks ?? []) union(`hit:${index}`, `decl:${link}`);
  });

  // A mention with no qualifier in a model, service, controller or repository file
  // votes for the file's entity group (member-repository.js -> email:member,
  // services/users.ts -> email:user). Each unnamed set joins the group most of its
  // members vote for, so a set spanning several files is not named by whichever
  // file comes first. Subject to cannot-link.
  // A receiver's class is the stronger evidence: `usersService.createOne({ email })`
  // is a user's email whichever file it sits in. Receiver votes decide a set before
  // file-role votes are counted.
  const votesFor = (vote: (hit: T) => string | undefined): void => {
    const votes = new Map<string, Map<string, number>>();
    hits.forEach((hit, index) => {
      if (hit.location === "comment" || (hit.group && !isWeak(hit))) return;
      const group = vote(hit);
      if (!group) return;
      const root = find(`hit:${index}`);
      if (nameOf.has(root)) return;
      const counts = votes.get(root) ?? new Map<string, number>();
      counts.set(group, (counts.get(group) ?? 0) + 1);
      votes.set(root, counts);
    });
    for (const [root, counts] of votes) {
      const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      union(root, groupNode(best[0]));
    }
  };
  phase = "receiver-vote";
  votesFor((hit) => (hit.receiverEntity ? `${hit.id}:${hit.receiverEntity}` : undefined));
  // The one table the enclosing function queries (`.from('directus_users')` -> user).
  phase = "table-vote";
  votesFor((hit) => (hit.tableEntity ? `${hit.id}:${hit.tableEntity}` : undefined));
  // Weak names apply now, subject to cannot-link.
  phase = "weak-name";
  hits.forEach((hit, index) => {
    if (hit.location === "comment" || !isWeak(hit) || !hit.group) return;
    union(`hit:${index}`, groupNode(hit.group));
  });
  phase = "file-vote";
  votesFor((hit) => {
    const entity = modelFileEntity(hit.evidence.filePath);
    return entity ? `${hit.id}:${entity}` : undefined;
  });

  // An unqualified set is named after its smallest declaration, so the id is stable.
  const declarationNameByRoot = new Map<string, string>();
  hits.forEach((hit, index) => {
    const declaration = hit.location === "comment" ? undefined : declarationNode(hit);
    if (!declaration) return;
    const root = find(`hit:${index}`);
    const current = declarationNameByRoot.get(root);
    if (current === undefined || declaration.localeCompare(current) < 0) {
      declarationNameByRoot.set(root, declaration);
    }
  });

  return hits.map((hit, index) => {
    if (hit.location === "comment") return hit;
    const root = find(`hit:${index}`);
    const name = nameOf.get(root) ?? declarationNameByRoot.get(root);
    return name === undefined || name === hit.group ? hit : { ...hit, group: name };
  });
}
