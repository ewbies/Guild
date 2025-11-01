# Upgrading to Cloudflare Workers Paid Plan

## Quick Reference

**Workers Paid Plan:** $5/month
- **KV Writes:** 100,000/day (vs 1,000/day free)
- **CPU Time:** 10M ms/month included
- **Data Transfer:** 10GB/month included

## Step-by-Step Upgrade Instructions

### Method 1: Through Workers Dashboard
1. Go to https://dash.cloudflare.com/
2. Navigate to **Workers & Pages** in left sidebar
3. Click on **Billing** or look for **"Upgrade to Paid"** button
4. Select **Workers Paid** plan ($5/month)
5. Add payment method and confirm

### Method 2: Through Account Billing
1. Go to https://dash.cloudflare.com/
2. Click your profile icon (top right)
3. Select **Billing** → **Workers Paid**
4. Click **Subscribe** or **Upgrade**
5. Follow payment prompts

### Method 3: Direct Link
Go to: `https://dash.cloudflare.com/<account-id>/workers/services/view/upgrade`

Replace `<account-id>` with your account ID (found in your dashboard URL).

## What You Get

| Feature | Free Tier | Workers Paid ($5/mo) |
|---------|-----------|---------------------|
| KV Writes/day | 1,000 | 100,000 |
| KV Reads/day | 100,000 | 100,000 |
| KV Storage | 1GB | 1GB |
| CPU Time/month | 10M ms | 10M ms (then $0.50/million) |
| Data Transfer/month | Unlimited* | 10GB (then $0.50/GB) |
| Workers/day | 100,000 | 10,000,000 |

*Free tier has fair use limits

## Before Upgrading

**Consider:** The optimization I just made (only saving when data changes) should reduce your KV writes by 80-95%. 

**Test first:** Deploy the optimized version and monitor for a day or two to see if you still need the paid plan.

## Payment Methods Accepted
- Credit/Debit Cards (Visa, Mastercard, American Express)
- PayPal
- UnionPay

## After Upgrading
- Upgrade takes effect immediately
- KV write limits increase from 1,000 to 100,000/day
- You'll be charged $5/month (or $50/year if annual)
- Can cancel anytime (cancellation takes effect at end of billing period)

## Cost Comparison

**Cloudflare Workers Paid:** $5/month = $60/year

**Alternative Options (from ALTERNATIVES.md):**
- Vercel + Upstash: ~$0-5/month (free tier often sufficient)
- Fly.io: Free for 3 shared VMs
- Railway: $5/month credit
- Netlify + Upstash: Free tier often sufficient

**Recommendation:** Try the optimized code first, then upgrade if still needed. The optimization should make the free tier work for most use cases.

