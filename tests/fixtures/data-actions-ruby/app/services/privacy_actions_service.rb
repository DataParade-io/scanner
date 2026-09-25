# Intentional Rails privacy-action spans for focused scanner coverage.
class PrivacyActionsService
  def process(params, webhook_url)
    attributes = params.require(:user).permit(:email, :phone)
    user = User.create!(attributes)
    user.update!(email: attributes[:email])
    user.save!
    Rails.logger.info("user email=#{user.email}")
    Faraday.post(webhook_url, { email: user.email })
    render json: { email: user.email }
    user.destroy!
  end
end
