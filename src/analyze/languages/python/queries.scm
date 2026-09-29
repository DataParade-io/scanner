; Python pack: maps the grammar onto the shared capture vocabulary
; (see src/analyze/engine/types.ts).

; ---- scopes
(function_definition) @scope.function
(lambda) @scope.function
(class_definition) @scope.class
(list_comprehension) @scope
(set_comprehension) @scope
(dictionary_comprehension) @scope
(generator_expression) @scope

; ---- definitions
(function_definition name: (identifier) @definition.function)
(class_definition name: (identifier) @definition.class)
(parameters (_) @definition.parameter)
(lambda_parameters (_) @definition.parameter)
(assignment left: (_) @definition.variable)
(for_statement left: (_) @definition.variable)
(for_in_clause left: (_) @definition.variable)
(named_expression name: (identifier) @definition.variable)
(as_pattern_target (_) @definition.variable)
(as_pattern alias: (_) @definition.variable)

; class-body assignments and self.x assignments define fields
(class_definition
  body: (block
    (expression_statement
      (assignment left: (identifier) @definition.field))))
(assignment
  left: (attribute
    object: (identifier) @_self
    attribute: (identifier) @definition.field)
  (#match? @_self "^(self|cls)$"))

; keyword arguments and dict keys are keys
(keyword_argument name: (identifier) @definition.key)
(pair key: (string) @definition.key)

; ---- imports
(import_statement name: (dotted_name (identifier) @import.name .))
(import_statement name: (aliased_import alias: (identifier) @import.name))
(import_from_statement name: (dotted_name (identifier) @import.name .))
(import_from_statement name: (aliased_import alias: (identifier) @import.name))

; ---- references
(identifier) @reference

; ---- member access and calls
(attribute
  object: (_) @member.object
  attribute: (_) @member.property) @member
(subscript
  value: (_) @member.object
  subscript: (_) @member.property) @member
(call
  function: (_) @call.callee
  arguments: (argument_list (_) @call.argument)) @call
