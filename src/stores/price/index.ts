import { ChainGetter, CoinGeckoPriceStore } from '@keplr-wallet/stores';
import { KVStore } from '@keplr-wallet/common';
import { FiatCurrency } from '@keplr-wallet/types';
import { computed, makeObservable, observable } from 'mobx';
import { ObservableQueryPools } from '../osmosis/query/pools';
import { Dec } from '@keplr-wallet/unit';

export interface IntermidiateRoute {
	/** pool:uosmo */
	readonly alternativeCoinId: string;
	readonly poolId: string;
	/** spotPrice of coin you want to calculate in usd but not in coingecko. eg) uosmo */
	readonly spotPriceSourceDenom: string;
	/** ibc/uatom in where uatom in hash */
	readonly spotPriceDestDenom: string;
	readonly destCoinId: string;
}

/**
 * PoolIntermediatePriceStore permits the some currencies that are not listed on the coingecko
 * to use the spot price of the pool as the intermediate.
 */
export class PoolIntermediatePriceStore extends CoinGeckoPriceStore {
	@observable.shallow
	protected _intermidiateRoutes: IntermidiateRoute[] = [];

	constructor(
		protected readonly osmosisChainId: string,
		protected readonly chainGetter: ChainGetter,
		kvStore: KVStore,
		supportedVsCurrencies: {
			[vsCurrency: string]: FiatCurrency;
		},
		protected readonly queryPool: ObservableQueryPools,
		intermidiateRoutes: IntermidiateRoute[]
	) {
		super(kvStore, supportedVsCurrencies);

		this._intermidiateRoutes = intermidiateRoutes;

		makeObservable(this);
	}

	@computed
	get intermidiateRoutesMap(): Map<string, IntermidiateRoute> {
		const result: Map<string, IntermidiateRoute> = new Map();

		for (const route of this._intermidiateRoutes) {
			result.set(route.alternativeCoinId, route);
		}

		return result;
	}

	/** if coinId is pool:XXX use route to getPrice */
	getPrice(coinId: string, vsCurrency: string): number | undefined {
		const routes = this.intermidiateRoutesMap;
		/** route = {
			alternativeCoinId: 'pool:uosmo',
			poolId: '1',
			spotPriceSourceDenom: 'uosmo',
			spotPriceDestDenom: DenomHelper.ibcDenom([{ portId: 'transfer', channelId: 'channel-0' }], 'uatom'),
			destCoinId: 'cosmos',
		} */
		const route = routes.get(coinId);
		if (route) {
			const pool = this.queryPool.getPool(route.poolId);
			if (!pool) {
				return;
			}

			const osmosisChainInfo = this.chainGetter.getChain(this.osmosisChainId);
			// If the currencies are unknown yet,
			// it is assumed that the raw currency with the 0 decimals.
			// But, using this raw currency will make improper result because it will create greater spot price than expected.
			// So, if the currencies are unknown, block calculating the price.
			if (
				!osmosisChainInfo.currencies.find(cur => cur.coinMinimalDenom === route.spotPriceSourceDenom) ||
				!osmosisChainInfo.currencies.find(cur => cur.coinMinimalDenom === route.spotPriceDestDenom)
			) {
				return;
			}

			const inSpotPrice = pool.calculateSpotPriceWithoutSwapFee(route.spotPriceSourceDenom, route.spotPriceDestDenom);
			const spotPriceDec = inSpotPrice.toDec().equals(new Dec(0)) ? new Dec(0) : new Dec(1).quo(inSpotPrice.toDec());
			const destCoinPrice = this.getPrice(route.destCoinId, vsCurrency);
			if (destCoinPrice === undefined) {
				return;
			}

			return parseFloat(spotPriceDec.toString()) * destCoinPrice;
		}

		return super.getPrice(coinId, vsCurrency);
	}
}
