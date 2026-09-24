class PaymentSync
  def call
    Stripe::Customer.list(limit: 10)
  end
end
