Rails.application.routes.draw do
  namespace :api do
    resources :users, only: %i[index show create]
    resource :profile, only: %i[show update]
  end
end
