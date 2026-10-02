; Ruby pack: maps the grammar onto the shared capture vocabulary
; (see src/analyze/engine/types.ts). A Ruby call carries its receiver and method
; (`user.email`, `Contact.new(...)`), so a call with a receiver is also a member access.

; ---- scopes
(method) @scope.function
(singleton_method) @scope.function
(lambda) @scope.function
(class) @scope.class
(module) @scope.class
(block) @scope
(do_block) @scope

; ---- definitions
(method name: (_) @definition.function)
(singleton_method name: (_) @definition.function)
(class name: (constant) @definition.class)
(module name: (constant) @definition.class)
(class name: (scope_resolution name: (constant) @definition.class))
(module name: (scope_resolution name: (constant) @definition.class))
(method_parameters (_) @definition.parameter)
(lambda_parameters (_) @definition.parameter)
(block_parameters (_) @definition.parameter)
(assignment left: (identifier) @definition.variable)
(operator_assignment left: (identifier) @definition.variable)

; instance variables and `self.x =` assignments define fields
(assignment left: (instance_variable) @definition.field)
(operator_assignment left: (instance_variable) @definition.field)
(assignment left: (call receiver: (self) method: (identifier) @definition.field))

; hash keys and keyword arguments (`email: email`, `"email" => x`, `:email => x`) are keys
(pair key: (hash_key_symbol) @definition.key)
(pair key: (simple_symbol) @definition.key)
(pair key: (string) @definition.key)

; ---- references
(identifier) @reference
(instance_variable) @reference

; ---- member access and calls
(call
  receiver: (_) @member.object
  method: (_) @member.property) @member
(element_reference
  object: (_) @member.object
  .
  (_) @member.property) @member
(call
  method: (_) @call.callee
  arguments: (argument_list (_) @call.argument)) @call

; every call, with or without arguments (callers, KDATAP-059e1e)
(call method: (_) @invocation.callee) @invocation
