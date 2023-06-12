import type { LogDescription } from "@ethersproject/abi";
import type { Log } from "@ethersproject/abstract-provider";
import type {
  MasaSBT,
  ReferenceSBTAuthority,
  ReferenceSBTSelfSovereign,
} from "@masa-finance/masa-contracts-identity";
import type { BaseContract } from "ethers";

import { MasaBase } from "../base";
import type { IIdentityContracts, MasaInterface } from "../interface";
import { loadIdentityContracts } from "./load-Identity-contracts";
import {
  ASBT,
  CreditScore,
  Green,
  Identity,
  SBT,
  SoulLinker,
  SoulName,
  SSSBT,
} from "./modules";

export class MasaContracts extends MasaBase {
  /**
   * direct contract access
   */
  public instances: IIdentityContracts;
  /**
   * SBTs
   */
  public sbt: SBT<MasaSBT>;
  public sssbt: SSSBT<ReferenceSBTSelfSovereign>;
  public asbt: ASBT<ReferenceSBTAuthority>;
  /**
   * Soul Linker
   */
  public soulLinker: SoulLinker;
  /**
   * Soul Name
   */
  public soulName: SoulName;
  /**
   * Credit Score
   */
  public creditScore: CreditScore;
  /**
   * Green
   */
  public green: Green;
  /**
   * Identity
   */
  public identity: Identity;

  public constructor(
    masa: MasaInterface,
    contractOverrides?: Partial<IIdentityContracts>
  ) {
    super(masa);

    this.instances = {
      ...loadIdentityContracts({
        provider: this.masa.config.signer.provider,
        networkName: this.masa.config.networkName,
      }),
      ...contractOverrides,
    };

    /**
     * SBTS
     */
    this.sbt = new SBT(this.masa, this.instances);
    this.sssbt = new SSSBT(this.masa, this.instances);
    this.asbt = new ASBT(this.masa, this.instances);
    /**
     * Soul Linker
     */
    this.soulLinker = new SoulLinker(this.masa, this.instances);
    /**
     * Soul Name
     */
    this.soulName = new SoulName(this.masa, this.instances);
    /**
     * Identity
     */
    this.identity = new Identity(this.masa, this.instances);
    /**
     * Credit Score
     */
    this.creditScore = new CreditScore(this.masa, this.instances);
    /**
     * Greens
     */
    this.green = new Green(this.masa, this.instances);
  }

  /**
   *
   * @param logs
   * @param additionalContracts
   */
  public parseLogs = (
    logs: Log[],
    additionalContracts: BaseContract[] = []
  ): LogDescription[] => {
    const parsedLogs: LogDescription[] = [];

    for (const contract of [
      ...Object.values(this.instances),
      ...additionalContracts,
    ]) {
      parsedLogs.push(
        ...logs
          .filter(
            (log: Log) =>
              log.address.toLowerCase() === contract.address.toLowerCase()
          )
          .map((log: Log) => {
            try {
              return contract.interface.parseLog(log);
            } catch (error) {
              if (error instanceof Error) {
                console.warn(error.message);
              }
            }
          })
      );
    }

    return parsedLogs;
  };
}
