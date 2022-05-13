enum PartyPokemonSaveKeys {
    attackBonusPercent = 0,
    attackBonusAmount,
    proteinsUsed,
    exp,
    breeding,
    shiny,
    category,
    levelEvolutionTriggered,
    heldItem
}

class PartyPokemon implements Saveable {
    saveKey: string;

    defaults = {
        attackBonusPercent: 0,
        attackBonusAmount: 0,
        proteinsUsed: 0,
        exp: 0,
        breeding: false,
        shiny: false,
        category: 0,
        levelEvolutionTriggered: false,
    };

    _breeding: KnockoutObservable<boolean>;
    _shiny: KnockoutObservable<boolean>;
    _level: KnockoutObservable<number>;
    _attack: KnockoutObservable<number>;
    _category: KnockoutObservable<number>;
    proteinsUsed: KnockoutObservable<number>;
    heldItem: KnockoutObservable<HeldItem>;

    constructor(
        public id: number,
        public name: PokemonNameType,
        public evolutions: Evolution[],
        public baseAttack: number,
        public attackBonusPercent: number = 0,
        public attackBonusAmount: number = 0,
        proteinsUsed,
        public exp: number = 0,
        breeding = false,
        shiny = false,
        category = 0
    ) {
        this.proteinsUsed = ko.observable(proteinsUsed);
        this._breeding = ko.observable(breeding);
        this._shiny = ko.observable(shiny);
        this._level = ko.observable(1);
        this._attack = ko.observable(this.calculateAttack());
        this._category = ko.observable(category);
        this.heldItem = ko.observable(undefined);
        this.heldItem.subscribe(hi => {
            this.attack = this.calculateAttack();
        });
    }

    public calculateAttack(ignoreLevel = false): number {
        const attackBonusMultiplier = 1 + (this.attackBonusPercent / 100);
        const levelMultiplier = ignoreLevel ? 1 : this.level / 100;
        const heldItemMultiplier = this.heldItem && this.heldItem() instanceof AttackBonusHeldItem ? (this.heldItem() as AttackBonusHeldItem).attackBonus : 1;
        return Math.max(1, Math.floor((this.baseAttack * attackBonusMultiplier + this.attackBonusAmount) * levelMultiplier * heldItemMultiplier));
    }

    calculateLevelFromExp() {
        const levelType = PokemonHelper.getPokemonByName(this.name).levelType;
        for (let i = this.level - 1; i < levelRequirements[levelType].length; i++) {
            if (levelRequirements[levelType][i] > this.exp) {
                return i;
            }
        }
        return this.level;
    }

    public gainExp(exp: number) {
        this.exp += exp * this.getExpMultiplier();
        const oldLevel = this.level;
        const newLevel = this.calculateLevelFromExp();
        if (oldLevel !== newLevel) {
            this.level = newLevel;
            this.attack = this.calculateAttack();
            this.checkForLevelEvolution();
        }
    }

    private getExpMultiplier() {
        let result = 1;
        if (this.heldItem() && this.heldItem() instanceof ExpGainedBonusHeldItem) {
            result *= (this.heldItem() as ExpGainedBonusHeldItem).gainedBonus;
        }
        return result;
    }

    public checkForLevelEvolution() {
        if (this.breeding || this.evolutions == null || this.evolutions.length == 0) {
            return;
        }

        for (const evolution of this.evolutions) {
            if (evolution instanceof LevelEvolution && evolution.isSatisfied()) {
                evolution.evolve();
            }
        }
    }

    public useStone(stoneType: GameConstants.StoneType): boolean {
        const possibleEvolutions = [];
        for (const evolution of this.evolutions) {
            if (evolution instanceof StoneEvolution && evolution.stone == stoneType && evolution.isSatisfied()) {
                possibleEvolutions.push(evolution);
            }
        }
        if (possibleEvolutions.length !== 0) {
            return Rand.fromArray(possibleEvolutions).evolve();
        }
        return false;
    }

    public useProtein(amount: number): void {
        if (App.game.challenges.list.disableProteins.active()) {
            Notifier.notify({
                title: 'Challenge Mode',
                message: 'Proteins are disabled',
                type: NotificationConstants.NotificationOption.danger,
            });
            return;
        }

        const usesRemaining = this.proteinUsesRemaining();

        // If no more proteins can be used on this Pokemon
        if (!usesRemaining) {
            Notifier.notify({
                message: 'This Pokémon cannot increase their power any higher!',
                type: NotificationConstants.NotificationOption.warning,
            });
            return;
        }

        // The lowest number of amount they want to use, total in inventory, uses remaining for this Pokemon
        amount = Math.min(amount, player.itemList.Protein(), usesRemaining);

        // Apply the proteins
        if (ItemHandler.useItem('Protein', amount)) {
            GameHelper.incrementObservable(this.proteinsUsed, amount);
        }
    }

    proteinUsesRemaining = (): number => {
        // Allow 5 for every region visited (including Kanto)
        return (player.highestRegion() + 1) * 5 - this.proteinsUsed();
    };

    public hideFromProteinList = (): boolean => {
        return this.breeding ||
            (this.proteinUsesRemaining() == 0 && Settings.getSetting('proteinHideMaxedPokemon').observableValue());
    }

    public giveHeldItem = (heldItem: HeldItem): void => {
        if (!this.heldItem() || heldItem.name != this.heldItem().name) {
            if (heldItem && !heldItem.canUse(this)) {
                Notifier.notify({
                    message: `This pokémon cannot use ${heldItem.displayName}.`,
                    type: NotificationConstants.NotificationOption.warning,
                });
                return;
            }
            if (player.amountOfItem(heldItem.name) < 1) {
                Notifier.notify({
                    message: `You don't have any ${heldItem.displayName} left.`,
                    type: NotificationConstants.NotificationOption.warning,
                });
                return;
            }
            if (App.game.party.caughtPokemon.some(p => p.heldItem() && p.heldItem().name == heldItem.name)) {
                Notifier.notify({
                    message: 'Only one of each held items can be used.',
                    type: NotificationConstants.NotificationOption.warning,
                });
                return;
            }

            if (App.game.party.caughtPokemon.filter(p => p.heldItem()).length >= 6) {
                Notifier.notify({
                    message: 'Only 6 pokemons can hold items at a time.',
                    type: NotificationConstants.NotificationOption.warning,
                });
                return;
            }
        }

        if (this.heldItem()) {
            Notifier.confirm({
                title: 'Remove held item',
                message: 'Held items are one time use only.\nRemoved items will be lost.\nAre you sure you want to remove it?',
                confirm: 'remove',
                type: NotificationConstants.NotificationOption.warning,
            }).then((confirmed) => {
                if (confirmed) {
                    this.addOrRemoveHeldItem(heldItem);
                }
            });
        } else { // Notifier.confirm is async
            this.addOrRemoveHeldItem(heldItem);
        }

    }
    private addOrRemoveHeldItem(heldItem: HeldItem) {
        if (this.heldItem() && this.heldItem().name == heldItem.name) {
            this.heldItem(undefined);
        } else {
            player.loseItem(heldItem.name, 1);
            this.heldItem(heldItem);
        }
    }

    public fromJSON(json: Record<string, any>): void {
        if (json == null) {
            return;
        }

        if (json['id'] == null) {
            return;
        }

        this.attackBonusPercent = json[PartyPokemonSaveKeys.attackBonusPercent] ?? this.defaults.attackBonusPercent;
        this.attackBonusAmount = json[PartyPokemonSaveKeys.attackBonusAmount] ?? this.defaults.attackBonusAmount;
        this.proteinsUsed = ko.observable(json[PartyPokemonSaveKeys.proteinsUsed] ?? this.defaults.proteinsUsed);
        this.exp = json[PartyPokemonSaveKeys.exp] ?? this.defaults.exp;
        this.breeding = json[PartyPokemonSaveKeys.breeding] ?? this.defaults.breeding;
        this.shiny = json[PartyPokemonSaveKeys.shiny] ?? this.defaults.shiny;
        this.category = json[PartyPokemonSaveKeys.category] ?? this.defaults.category;
        this.level = this.calculateLevelFromExp();
        this.attack = this.calculateAttack();
        this.heldItem(json['heldItem'] && ItemList[json['heldItem']] instanceof HeldItem ? ItemList[json['heldItem']] as HeldItem : undefined);

        if (this.evolutions != null) {
            for (const evolution of this.evolutions) {
                if (evolution instanceof LevelEvolution) {
                    evolution.triggered = json[PartyPokemonSaveKeys.levelEvolutionTriggered] ?? this.defaults.levelEvolutionTriggered;
                }
            }
        }

    }

    public toJSON() {
        let levelEvolutionTriggered = false;
        if (this.evolutions != null) {
            for (const evolution of this.evolutions) {
                if (evolution instanceof LevelEvolution && evolution.triggered) {
                    levelEvolutionTriggered = true;
                }
            }
        }
        const output = {
            id: this.id,
            [PartyPokemonSaveKeys.attackBonusPercent]: this.attackBonusPercent,
            [PartyPokemonSaveKeys.attackBonusAmount]: this.attackBonusAmount,
            [PartyPokemonSaveKeys.proteinsUsed]: this.proteinsUsed(),
            [PartyPokemonSaveKeys.exp]: this.exp,
            [PartyPokemonSaveKeys.breeding]: this.breeding,
            [PartyPokemonSaveKeys.shiny]: this.shiny,
            [PartyPokemonSaveKeys.levelEvolutionTriggered]: levelEvolutionTriggered,
            [PartyPokemonSaveKeys.category]: this.category,
            [PartyPokemonSaveKeys.heldItem]: this.heldItem()?.name,
        };

        // Don't save anything that is the default option
        Object.entries(output).forEach(([key, value]) => {
            if (value === this.defaults[PartyPokemonSaveKeys[key]]) {
                delete output[key];
            }
        });

        return output;
    }

    // Knockout getters/setter
    get level(): number {
        return this._level();
    }

    set level(level: number) {
        this._level(level);
    }

    get attack(): number {
        return this._attack();
    }

    set attack(attack: number) {
        this._attack(attack);
    }

    get breeding(): boolean {
        return this._breeding();
    }

    set breeding(bool: boolean) {
        this._breeding(bool);
    }

    get shiny(): boolean {
        return this._shiny();
    }

    set shiny(bool: boolean) {
        this._shiny(bool);
    }

    get category(): number {
        return this._category();
    }

    set category(index: number) {
        this._category(index);
    }
}
