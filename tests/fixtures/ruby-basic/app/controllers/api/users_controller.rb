module Api
  class UsersController < ApplicationController
    def index
      render json: User.all
    end

    def create
      user = User.create!(params.require(:user).permit(:email))
      render json: user
    end
  end
end
