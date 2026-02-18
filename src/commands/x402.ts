import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { loadConfig } from '../core/config.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { confirmTransaction } from '../security/input.js';
import {
  parsePaymentRequired,
  selectPaymentOption,
  signTransferWithAuthorization,
  buildPaymentHeader,
  parseSettlementResponse,
  findRpcUrlForChainId,
} from '../x402/client.js';
import { CAIP2_CHAIN_ID_MAP, getPaymentAmount, type PaymentPayload } from '../x402/types.js';
import type { Address } from 'viem';

export function registerX402Command(program: Command): void {
  program
    .command('x402')
    .description('Make an HTTP request with x402 automatic payment')
    .argument('<url>', 'URL to request')
    .option('--token <token>', 'Session token')
    .option('--method <method>', 'HTTP method', 'GET')
    .option('--header <header...>', 'HTTP headers (Key:Value format, repeatable)')
    .option('--body <body>', 'Request body (or @filepath to read from file)')
    .option('--account-index <index>', 'Account index', '0')
    .option('--dry-run', 'Show payment requirements without paying')
    .option('--yes', 'Skip payment confirmation')
    .option('--name <name>', 'Wallet name', 'default')
    .option('--max-amount <amount>', 'Maximum amount willing to pay (human-readable, e.g. "0.10")')
    .action(async (url: string, opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        const sessionToken = await resolveToken(walletDir, opts.name, opts.token);
        const mnemonic = await validateSession(walletDir, opts.name, sessionToken);
        const config = await loadConfig(walletDir);
        const accountIndex = parseInt(opts.accountIndex) || 0;

        // Parse custom headers
        const headers: Record<string, string> = {};
        if (opts.header) {
          for (const h of opts.header as string[]) {
            const colonIdx = h.indexOf(':');
            if (colonIdx === -1) {
              throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, `Invalid header format: "${h}". Use Key:Value`);
            }
            headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
          }
        }

        // Resolve request body
        let requestBody: string | undefined;
        if (opts.body) {
          if (opts.body.startsWith('@')) {
            requestBody = await readFile(opts.body.slice(1), 'utf-8');
          } else {
            requestBody = opts.body;
          }
        }

        // Make initial request
        const initialResponse = await fetch(url, {
          method: opts.method.toUpperCase(),
          headers,
          body: requestBody,
        });

        // If not 402, output response directly
        if (initialResponse.status !== 402) {
          const responseBody = await initialResponse.text();
          outputSuccess({
            paid: false,
            response: {
              status: initialResponse.status,
              headers: Object.fromEntries(initialResponse.headers.entries()),
              body: responseBody,
            },
          }, format, quiet);
          return;
        }

        // Parse 402 payment requirements
        const paymentRequired = await parsePaymentRequired(initialResponse);
        const option = selectPaymentOption(paymentRequired);

        // Resolve chain ID from CAIP-2 network string
        const chainId = CAIP2_CHAIN_ID_MAP[option.network];
        if (chainId === undefined) {
          throw new WalletError(ErrorCodes.ERR_X402_UNSUPPORTED_NETWORK, `Unsupported network: ${option.network}`);
        }

        // Find RPC URL from config
        const { rpcUrl, networkName } = findRpcUrlForChainId(config, chainId);

        // Resolve payment amount (servers use either "amount" or "maxAmountRequired")
        const paymentAmount = getPaymentAmount(option);

        // Check max amount if set
        if (opts.maxAmount) {
          const maxAmountRaw = parseFloat(opts.maxAmount);
          // Assume 6 decimals for stablecoins (USDC/USDT)
          const maxAmountSmallest = BigInt(Math.floor(maxAmountRaw * 1e6));
          const requiredAmount = BigInt(paymentAmount);
          if (requiredAmount > maxAmountSmallest) {
            throw new WalletError(
              ErrorCodes.ERR_X402_AMOUNT_EXCEEDED,
              `Payment amount ${paymentAmount} exceeds maximum ${maxAmountSmallest.toString()} (${opts.maxAmount} with 6 decimals)`,
            );
          }
        }

        // Extract resource info (present in V2 responses)
        const resource = 'resource' in paymentRequired ? paymentRequired.resource : undefined;

        // Dry run: output payment requirements and exit
        if (opts.dryRun) {
          outputSuccess({
            paid: false,
            dry_run: true,
            payment_required: {
              x402_version: paymentRequired.x402Version,
              scheme: option.scheme,
              network: option.network,
              chain_id: chainId,
              network_name: networkName,
              asset: option.asset,
              amount: paymentAmount,
              pay_to: option.payTo,
              max_timeout_seconds: option.maxTimeoutSeconds,
              description: resource?.description,
              resource: resource?.url,
            },
          }, format, quiet);
          return;
        }

        // Confirm payment unless --yes
        if (!opts.yes) {
          const amountHuman = (Number(paymentAmount) / 1e6).toFixed(6);
          const confirmed = await confirmTransaction({
            Action: 'x402 Payment',
            Network: `${option.network} (${networkName})`,
            Asset: option.asset,
            Amount: `${amountHuman} (${paymentAmount} smallest unit)`,
            'Pay To': option.payTo,
            URL: url,
          });
          if (!confirmed) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Payment cancelled by user');
          }
        }

        // Sign TransferWithAuthorization
        const signResult = await signTransferWithAuthorization({
          mnemonic,
          accountIndex,
          rpcUrl,
          chainId,
          tokenAddress: option.asset as Address,
          payTo: option.payTo,
          value: BigInt(paymentAmount),
          extraName: option.extra?.name,
          extraVersion: option.extra?.version,
        });

        // Build payment header (V2 spec: resource + accepted + payload)
        const paymentPayload: PaymentPayload = {
          x402Version: paymentRequired.x402Version,
          resource,
          accepted: option,
          payload: signResult,
        };
        const { name: headerName, value: headerValue } = buildPaymentHeader(paymentPayload);

        // Retry request with payment signature header
        const retryHeaders = { ...headers, [headerName]: headerValue };
        const retryResponse = await fetch(url, {
          method: opts.method.toUpperCase(),
          headers: retryHeaders,
          body: requestBody,
        });

        // Parse settlement response
        const settlement = parseSettlementResponse(retryResponse);
        const responseBody = await retryResponse.text();

        if (!retryResponse.ok) {
          throw new WalletError(
            ErrorCodes.ERR_X402_PAYMENT_FAILED,
            `Payment request failed with status ${retryResponse.status}: ${responseBody}`,
          );
        }

        outputSuccess({
          paid: true,
          payment: {
            scheme: option.scheme,
            network: option.network,
            asset: option.asset,
            amount: paymentAmount,
            pay_to: option.payTo,
            from: signResult.authorization.from,
          },
          settlement: settlement ? {
            success: settlement.success,
            tx_hash: settlement.txHash ?? settlement.transaction,
            network: settlement.network,
          } : undefined,
          response: {
            status: retryResponse.status,
            headers: Object.fromEntries(retryResponse.headers.entries()),
            body: responseBody,
          },
        }, format, quiet);
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
