    const parsedAmount =
      typeof amount === "number" ? amount : typeof amount === "string" ? parseFloat(amount) : NaN;

    if (!isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < 100)
      throwSafe("DEPOSIT", "Minimum deposit is 100 ETB.", "Amount below minimum: " + parsedAmount);
    let parsedAmount = 0;

    if (typeof amount === "number") {
      if (!Number.isFinite(amount) || amount < 0) {
        throwSafe("DEPOSIT", "Enter a deposit amount above 0 ETB, or leave it blank.", "Invalid deposit amount: " + String(amount));
      }
      parsedAmount = amount;
    } else if (typeof amount === "string") {
      const trimmedAmount = amount.trim();
      if (trimmedAmount.length > 0) {
        const amountValue = Number(trimmedAmount);
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
          throwSafe("DEPOSIT", "Enter a deposit amount above 0 ETB, or leave it blank.", "Invalid deposit amount: " + trimmedAmount);
        }
        parsedAmount = amountValue;
      }
    }

    return {
      accessToken,
      amount: !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0,
      amount: parsedAmount,
      paymentMethodId,
      transactionReference: transactionReference.trim(),
    };
-- a/src/routes/_app/deposit.tsx
++ b/src/routes/_app/deposit.tsx

      return;
    }

    const numAmount = amount ? parseFloat(amount) : 0;
    if (amount && (isNaN(numAmount) || numAmount < 100)) {
      toast.error("Minimum deposit amount is 100 ETB.");
    const amountInput = amount.trim();
    const numAmount = amountInput ? parseFloat(amountInput) : 0;
    if (amountInput && (!Number.isFinite(numAmount) || numAmount <= 0)) {
      toast.error("Enter a deposit amount above 0 ETB, or leave it blank.");
      return;
    }


              placeholder="Enter deposit amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="100"
              min="0.01"
              step="0.01"
              hint="The actual amount will be verified from the receipt"
            />
