class User < ApplicationRecord
  include Searchable

  devise :database_authenticatable
end
