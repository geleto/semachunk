"""Draw the full-budget cutoff and matched-placement curves for cross-document retrieval."""
import gzip
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import MaxNLocator, PercentFormatter

results=Path(__file__).resolve().parent/"results"
with gzip.open(results/"2026-11-27-passage-placement.json.gz") as f:
    data=json.load(f)
cutoffs=data["protocol"]["cutoffs"]
colors={"joint":"#086475","one":"#B04E22","semantic":"#086475","even":"#A64A79","distinctEven":"#9A6819"}
fig,axes=plt.subplots(3,2,figsize=(10,8.3),sharex=True,layout="constrained")
for i,(fold,family,title,methods,labels) in enumerate([
        ("confirmation","combined","Confirmation · combined",("joint","one"),("Full passage embedding","30% neighbour vectors")),
        ("shared-holdout","combined","58 documents · combined",("joint","one"),("Full passage embedding","30% neighbour vectors")),
        ("shared-holdout","lattice","58 documents · matched count",("semantic","even","distinctEven"),
         ("Semantic centres","Even spacing, equal centre count","Even spacing, equal distinct passages"))]):
    curves=data["folds"][fold]["rates"]
    for j in range(2):
        ax=axes[i,j]
        for m,label in zip(methods,labels):
            ys=[100*curves[f"{family}/{t}/{m}"][j] for t in cutoffs]
            marker="o" if m in ("joint","semantic") else "^" if m=="distinctEven" else "s"
            ax.plot(cutoffs,ys,marker=marker,markersize=3.2,lw=1.75,color=colors[m],label=label)
        ax.axhline(100*curves["tuned"][j],color="#484D50",ls="--",lw=1.2,label="Tuned blocks")
        ax.grid(axis="y",alpha=.2)
        ax.yaxis.set_major_formatter(PercentFormatter(100,decimals=0))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=6,integer=True))
        ax.spines[["top","right"]].set_visible(False)
        if i==0:
            ax.set_title(("Complete evidence in the first passage","Complete evidence across the first five")[j],loc="left",fontsize=12)
        if i==2:
            ax.set_xlabel("Semantic split cutoff")
        ax.set_xticks([0,.15,.3,.45,.55,.75])
        if j==0:
            ax.set_ylabel(title)
            handles=[Line2D([],[],color=colors[m],lw=2,label=lab) for m,lab in zip(methods,labels)]
            handles.append(Line2D([],[],color="#484D50",ls="--",label="Tuned blocks"))
            ax.legend(handles=handles,fontsize=8,framealpha=.9)
fig.suptitle("Retrieval across 16 semantic split cutoffs  ·  512-token passage limit",fontsize=14)
fig.savefig(results/"2026-11-27-passage-placement.png",dpi=165)
