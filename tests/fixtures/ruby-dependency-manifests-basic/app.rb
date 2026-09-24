class BillingApp
  def charge
    Stripe::PaymentIntent.create
  end
end
