; JavaScript pack: maps the grammar onto the shared capture vocabulary
; (see src/analyze/engine/types.ts).

; ---- scopes
(function_declaration) @scope.function
(generator_function_declaration) @scope.function
(function_expression) @scope.function
(generator_function) @scope.function
(arrow_function) @scope.function
(method_definition) @scope.function
(class_declaration) @scope.class
(class) @scope.class
(statement_block) @scope
(for_statement) @scope
(for_in_statement) @scope
(catch_clause) @scope

; ---- definitions
(function_declaration name: (identifier) @definition.function)
(generator_function_declaration name: (identifier) @definition.function)
(function_expression name: (identifier) @definition.function)
(class_declaration name: (identifier) @definition.class)
(class name: (identifier) @definition.class)
(method_definition name: [(property_identifier) (private_property_identifier)] @definition.function)
(field_definition property: [(property_identifier) (private_property_identifier)] @definition.field)
(assignment_expression
  left: (member_expression
    object: (this)
    property: [(property_identifier) (private_property_identifier)] @definition.field))
(formal_parameters (_) @definition.parameter)
(arrow_function parameter: (identifier) @definition.parameter)
(variable_declarator name: (_) @definition.variable)
; a loop variable is a parameter of the loop body; destructured loop names are locals
(for_in_statement left: (identifier) @definition.parameter)
(for_in_statement left: [(object_pattern) (array_pattern)] @definition.variable)
(catch_clause parameter: (_) @definition.variable)
(pair key: [(property_identifier) (string) (number)] @definition.key)

; ---- imports
(import_specifier !alias name: (identifier) @import.name)
(import_specifier alias: (identifier) @import.name)
(import_clause (identifier) @import.name)
(namespace_import (identifier) @import.name)

; ---- references
(identifier) @reference
(shorthand_property_identifier) @reference

; ---- member access and calls
(member_expression
  object: (_) @member.object
  property: (_) @member.property) @member
(subscript_expression
  object: (_) @member.object
  index: (_) @member.property) @member
(call_expression
  function: (_) @call.callee
  arguments: (arguments (_) @call.argument)) @call
