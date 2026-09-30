; TypeScript pack (also used for TSX): maps the grammar onto the shared capture vocabulary
; (see src/analyze/engine/types.ts).

; ---- scopes
(function_declaration) @scope.function
(generator_function_declaration) @scope.function
(function_expression) @scope.function
(generator_function) @scope.function
(arrow_function) @scope.function
(method_definition) @scope.function
(class_declaration) @scope.class
(abstract_class_declaration) @scope.class
(interface_declaration) @scope.class
(function_signature) @scope.function
(class) @scope.class
(statement_block) @scope
(for_statement) @scope
(for_in_statement) @scope
(catch_clause) @scope

; ---- definitions
(function_declaration name: (identifier) @definition.function)
(generator_function_declaration name: (identifier) @definition.function)
(function_expression name: (identifier) @definition.function)
(class_declaration name: (type_identifier) @definition.class)
(class name: (type_identifier) @definition.class)
(method_definition name: [(property_identifier) (private_property_identifier)] @definition.function)
(public_field_definition name: [(property_identifier) (private_property_identifier)] @definition.field)
(assignment_expression
  left: (member_expression
    object: (this)
    property: [(property_identifier) (private_property_identifier)] @definition.field))
(required_parameter pattern: (_) @definition.parameter)
(optional_parameter pattern: (_) @definition.parameter)
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
; a destructuring assignment target reads and writes an existing binding: ({ email } = inquiry)
(shorthand_property_identifier_pattern) @reference

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

; ---- TypeScript additions
(abstract_class_declaration name: (type_identifier) @definition.class)
(interface_declaration name: (type_identifier) @definition.class)
(function_signature name: (identifier) @definition.function)
(property_signature name: [(property_identifier) (string)] @definition.key)
(method_signature name: (property_identifier) @definition.key)
(abstract_method_signature name: (property_identifier) @definition.function)
(required_parameter (accessibility_modifier) pattern: (identifier) @definition.field)
(optional_parameter (accessibility_modifier) pattern: (identifier) @definition.field)
