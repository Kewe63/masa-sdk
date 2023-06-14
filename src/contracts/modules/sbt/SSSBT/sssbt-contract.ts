import type { LogDescription } from "@ethersproject/abi";
import { BigNumber } from "@ethersproject/bignumber";
import type { ReferenceSBTSelfSovereign } from "@masa-finance/masa-contracts-identity";
import type { PayableOverrides, TypedDataDomain, TypedDataField } from "ethers";

import { Messages } from "../../../../collections";
import type { PaymentMethod } from "../../../../interface";
import { IIdentityContracts, MasaInterface } from "../../../../interface";
import {
  generateSignatureDomain,
  isNativeCurrency,
  signTypedData,
} from "../../../../utils";
import { SBTContract } from "../SBT";
import type { SSSBTContractWrapper } from "./sssbt-contract-wrapper";

export class SSSBTContract<
  Contract extends ReferenceSBTSelfSovereign
> extends SBTContract<Contract> {
  /**
   *
   * @param masa
   * @param instances
   */
  constructor(masa: MasaInterface, instances: IIdentityContracts) {
    super(masa, instances);

    this.attach.bind(this);
  }

  /**
   *
   * @param sbtContract
   */
  public attach(sbtContract: Contract): SSSBTContractWrapper<Contract> {
    return {
      ...super.attach(sbtContract),

      /**
       * Signs an SBT based on its address
       * @param name
       * @param types
       * @param value
       */
      sign: async (
        name: string,
        types: Record<string, Array<TypedDataField>>,
        value: Record<string, string | BigNumber | number>
      ): Promise<{
        signature: string;
        authorityAddress: string;
      }> => {
        const authorityAddress = await this.masa.config.signer.getAddress();

        const { signature, domain } = await signTypedData(
          sbtContract,
          this.masa.config.signer,
          name,
          types,
          value
        );

        await this.verify(
          "Signing SBT failed!",
          sbtContract,
          domain,
          types,
          value,
          signature,
          authorityAddress
        );

        return { signature, authorityAddress };
      },

      /**
       *
       * @param paymentMethod
       * @param name
       * @param types
       * @param value
       * @param signature
       * @param authorityAddress
       * @param slippage
       */
      prepareMint: async (
        paymentMethod: PaymentMethod,
        name: string,
        types: Record<string, Array<TypedDataField>>,
        value: Record<string, string | BigNumber | number>,
        signature: string,
        authorityAddress: string,
        slippage: number | undefined = 250
      ): Promise<{
        paymentAddress: string;
        price: BigNumber;
        formattedPrice: string;
        mintFee: BigNumber;
        formattedMintFee: string;
        protocolFee: BigNumber;
        formattedProtocolFee: string;
      }> => {
        const domain: TypedDataDomain = await generateSignatureDomain(
          this.masa.config.signer,
          name,
          sbtContract.address
        );

        await this.verify(
          "Verifying SBT failed!",
          sbtContract,
          domain,
          types,
          value,
          signature,
          authorityAddress
        );

        const { getPrice } = this.attach(sbtContract);
        const sssbtMintPriceInfo = await getPrice(paymentMethod, slippage);

        if (this.masa.config.verbose) {
          console.dir(
            {
              sssbtMintPriceInfo,
            },
            {
              depth: null,
            }
          );
        }

        return sssbtMintPriceInfo;
      },

      /**
       *
       * @param paymentMethod
       * @param receiver
       * @param signature
       * @param signatureDate
       * @param authorityAddress
       */
      mint: async (
        paymentMethod: PaymentMethod,
        receiver: string,
        signature: string,
        signatureDate: number,
        authorityAddress: string
      ): Promise<boolean> => {
        // current limit for SSSBT is 1 on the default installation
        let limit: number = 1;

        try {
          limit = (await sbtContract.maxSBTToMint()).toNumber();
        } catch {
          if (this.masa.config.verbose) {
            console.info("Loading limit failed, falling back to 1!");
          }
        }

        try {
          const balance: BigNumber = await sbtContract.balanceOf(receiver);

          if (limit > 0 && balance.gte(limit)) {
            console.error(
              `Minting of SSSBT failed: '${receiver}' exceeded the limit of '${limit}'!`
            );
            return false;
          }
        } catch (error: unknown) {
          if (error instanceof Error) {
            console.warn(error.message);
          }
        }

        const types = {
          Mint: [
            { name: "to", type: "address" },
            { name: "authorityAddress", type: "address" },
            { name: "signatureDate", type: "uint256" },
          ],
        };

        // fill the collection with data
        const value: {
          to: string;
          authorityAddress: string;
          signatureDate: number;
        } = {
          to: receiver,
          authorityAddress,
          signatureDate,
        };

        const { prepareMint } = this.attach(sbtContract);

        const { price, paymentAddress } = await prepareMint(
          paymentMethod,
          "ReferenceSBTSelfSovereign",
          types,
          value,
          signature,
          authorityAddress
        );

        const mintSSSBTArguments: [
          string, // paymentMethod string
          string, // to string
          string, // authorityAddress string
          number, // authorityAddress number
          string // signature string
        ] = [
          paymentAddress,
          receiver,
          authorityAddress,
          signatureDate,
          signature,
        ];

        const feeData = await this.getNetworkFeeInformation();

        const mintSSSBTOverrides: PayableOverrides = {
          value: isNativeCurrency(paymentMethod) ? price : undefined,
          ...(feeData && feeData.maxPriorityFeePerGas
            ? {
                maxPriorityFeePerGas: BigNumber.from(
                  feeData.maxPriorityFeePerGas
                ),
              }
            : undefined),
          ...(feeData && feeData.maxFeePerGas
            ? {
                maxFeePerGas: BigNumber.from(feeData.maxFeePerGas),
              }
            : undefined),
        };

        if (this.masa.config.verbose) {
          console.dir(
            {
              mintSSSBTArguments,
              mintSSSBTOverrides,
            },
            {
              depth: null,
            }
          );
        }

        const {
          "mint(address,address,address,uint256,bytes)": mint,
          estimateGas: {
            "mint(address,address,address,uint256,bytes)": estimateGas,
          },
        } = sbtContract;

        let gasLimit: BigNumber = await estimateGas(
          ...mintSSSBTArguments,
          mintSSSBTOverrides
        );

        if (this.masa.config.network?.gasSlippagePercentage) {
          gasLimit = SSSBTContract.addSlippage(
            gasLimit,
            this.masa.config.network.gasSlippagePercentage
          );
        }

        const { wait, hash } = await mint(...mintSSSBTArguments, {
          ...mintSSSBTOverrides,
          gasLimit,
        });

        console.log(
          Messages.WaitingToFinalize(
            hash,
            this.masa.config.network?.blockExplorerUrls?.[0]
          )
        );

        const { logs } = await wait();

        const parsedLogs = this.masa.contracts.parseLogs(logs, [sbtContract]);

        const mintEvent = parsedLogs.find(
          (log: LogDescription) => log.name === "Mint"
        );

        if (mintEvent) {
          const { args } = mintEvent;
          console.log(
            `Minted to token with ID: ${args._tokenId} receiver '${args._owner}'`
          );

          return true;
        }

        return false;
      },
    };
  }
}
