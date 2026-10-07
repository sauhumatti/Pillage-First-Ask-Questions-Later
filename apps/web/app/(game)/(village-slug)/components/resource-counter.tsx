import { clsx } from 'clsx';
import { use } from 'react';
import { useTranslation } from 'react-i18next';
import type { Resource } from '@pillage-first/types/models/resource';
import {
  formatNumberWithCommas,
  truncateToShortForm,
} from '@pillage-first/utils/format';
import { useMediaQuery } from 'app/(game)/(village-slug)/hooks/dom/use-media-query';
import { useCalculatedResource } from 'app/(game)/(village-slug)/hooks/use-calculated-resource';
import { CurrentVillageComputedEffectsContext } from 'app/(game)/(village-slug)/providers/current-village-computed-effects-context';
import { Icon } from 'app/components/icon';

type ResourceCounterProps = {
  resource: Resource;
  showDetails?: boolean;
};

export const ResourceCounter = ({
  resource,
  showDetails = true,
}: ResourceCounterProps) => {
  const { t } = useTranslation();
  const resourceLabels = {
    wood: t('Wood'),
    clay: t('Clay'),
    iron: t('Iron'),
    wheat: t('Wheat'),
  };
  const isWiderThanLg = useMediaQuery('(min-width: 1024px)');
  const { computedWarehouseCapacityEffect, computedGranaryCapacityEffect } =
    use(CurrentVillageComputedEffectsContext);
  const storage =
    resource === 'wheat'
      ? computedGranaryCapacityEffect.total
      : computedWarehouseCapacityEffect.total;

  const {
    calculatedResourceAmount,
    hourlyProduction,
    storageCapacity,
    isFull,
    hasNegativeProduction,
  } = useCalculatedResource(resource, storage);

  const storagePercentage =
    storageCapacity > 0
      ? Math.min(
          100,
          Math.max(0, (calculatedResourceAmount / storageCapacity) * 100),
        )
      : 0;

  const formattedCurrentAmount = formatNumberWithCommas(
    calculatedResourceAmount,
  );

  const formattedStorageCapacity = truncateToShortForm(storageCapacity);
  const formattedHourlyProduction = isWiderThanLg
    ? formatNumberWithCommas(hourlyProduction)
    : truncateToShortForm(hourlyProduction);

  return (
    <div className="resource-card flex min-w-0 w-full flex-col gap-1.5 rounded-lg px-1.5 py-1.5 sm:px-2.5">
      <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase sm:text-[10px]">
        {resourceLabels[resource]}
      </span>
      <div className="flex w-full items-center justify-between">
        <Icon
          className="size-4 lg:size-6"
          type={resource}
        />
        <span className="inline-flex items-center">
          <span className="text-xs lg:text-sm font-semibold leading-none tabular-nums">
            {formattedCurrentAmount}
          </span>
          <span className="hidden lg:inline-flex text-xs text-muted-foreground font-normal leading-none transition-colors">
            /{formattedStorageCapacity}
          </span>
        </span>
      </div>
      <div className="relative flex h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
        <div
          className={clsx(
            isFull || hasNegativeProduction
              ? 'bg-amber-600 dark:bg-amber-400'
              : 'bg-emerald-700 dark:bg-emerald-400',
            'flex w-full h-full rounded-full origin-left transition-transform',
          )}
          style={{
            transform: `scaleX(${storagePercentage / 100})`,
          }}
        />
      </div>
      <div
        aria-hidden={!showDetails}
        className={clsx(
          showDetails
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0',
          'grid transition-all duration-300 ease-out lg:grid-rows-[1fr] lg:opacity-100',
        )}
      >
        <div className="overflow-hidden">
          <div className="flex justify-between lg:justify-end items-center">
            <span className="inline-flex lg:hidden text-2xs md:text-xs">
              {formattedStorageCapacity}
            </span>
            <span
              className={clsx(
                'inline-flex text-2xs md:text-xs tabular-nums',
                hasNegativeProduction
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {formattedHourlyProduction}/h
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
