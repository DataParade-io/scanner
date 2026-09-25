Rails.application.routes.draw do
  post "/privacy-actions", to: "privacy_actions#create"
end
